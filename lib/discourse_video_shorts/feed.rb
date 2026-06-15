# frozen_string_literal: true

require "cgi"
require "nokogiri"

module DiscourseVideoShorts
  class Feed
    INVALID_CURSOR = Class.new(StandardError)
    IFRAME_TEXT_PATTERN = %r{<iframe\b[^>]*>.*?</iframe>}im
    IFRAME_OPEN_TEXT_PATTERN = %r{<iframe\b[^>]*>}im
    IFRAME_FRAGMENT_TEXT_PATTERN = %r{<iframe\b.*}im

    def initialize(guardian:, page_size: nil, scan_limit: nil, cursor: nil)
      @guardian = guardian
      @page_size_param = page_size
      @scan_limit_param = scan_limit
      @cursor = cursor
    end

    def self.invalid_cursor_json
      { error: "invalid_cursor" }
    end

    def call
      source = source_selection
      cursor_payload = parse_cursor(source.cursor_scope_digest)
      candidates = load_candidates(source, cursor_payload)
      scan_result = scan_candidates(candidates, source)

      {
        items: scan_result.items,
        next_cursor: next_cursor(scan_result, source),
        scan_limit_reached: scan_result.scan_limit_reached,
      }
    end

    private

    ScanResult = Data.define(:items, :last_scanned_post, :has_more, :scan_limit_reached)

    attr_reader :guardian, :page_size_param, :scan_limit_param, :cursor

    def source_selection
      @source_selection ||=
        SourceSelection.new(
          guardian: guardian,
          page_size: safe_positive_integer(page_size_param),
          candidate_scan_limit: safe_positive_integer(scan_limit_param),
        ).resolve
    end

    def load_candidates(source, cursor_payload)
      return [] if source.effective_category_ids.blank? && source.effective_tag_names.blank?

      scope =
        Post
          .joins(:topic)
          .includes(:uploads, :user, topic: %i[category tags])
          .where(post_type: Post.types[:regular])
          .where(deleted_at: nil)
          .where(topics: { deleted_at: nil })

      scope = apply_source_filter(scope, source.effective_category_ids, source.effective_tag_names)
      scope = apply_cursor(scope, cursor_payload) if cursor_payload.present?
      scope.order("posts.created_at DESC, posts.id DESC").limit(source.candidate_scan_limit + 1).to_a
    end

    def scan_candidates(candidates, source)
      extracted = []
      dedupe_keys = Set.new
      last_scanned_post = nil
      scanned_count = 0
      has_more = false

      candidates.first(source.candidate_scan_limit).each_with_index do |post, index|
        last_scanned_post = post
        scanned_count += 1

        if guardian.can_see?(post.topic) && guardian.can_see?(post)
          media = MediaExtractorCache.extract_media_for_visible_post(post, guardian)
          if media.present? && !dedupe_keys.include?(media[:dedupe_key])
            dedupe_keys << media[:dedupe_key]
            extracted << [post, media]
          end
        end

        if extracted.length >= source.page_size
          has_more = candidates[index + 1].present?
          return ScanResult.new(
            items: serialize_items(extracted),
            last_scanned_post: last_scanned_post,
            has_more: has_more,
            scan_limit_reached: false,
          )
        end
      end

      has_more = candidates.length > source.candidate_scan_limit
      ScanResult.new(
        items: serialize_items(extracted),
        last_scanned_post: last_scanned_post,
        has_more: has_more,
        scan_limit_reached: has_more && scanned_count >= source.candidate_scan_limit,
      )
    end

    def serialize_items(extracted)
      posts = extracted.map(&:first)
      liked_post_ids = liked_post_ids(posts)
      bookmarks_by_post_id = bookmarks_by_post_id(posts)

      extracted.map do |post, media|
        native_action_summary = native_action_summary(post)
        serialize_item(
          post,
          media,
          liked_post_ids: liked_post_ids,
          bookmarks_by_post_id: bookmarks_by_post_id,
          native_action_summary: native_action_summary,
        )
      end
    end

    def serialize_item(post, media, liked_post_ids:, bookmarks_by_post_id:, native_action_summary:)
      topic = post.topic
      {
        topic_id: topic.id,
        post_id: post.id,
        post_number: post.post_number,
        topic_url: topic.relative_url,
        post_url: post.url,
        title: topic.title,
        excerpt: PrettyText.excerpt(excerpt_html(post, media), 220, keep_emoji_images: false),
        username: post.user&.username,
        avatar_template: post.user&.avatar_template,
        created_at: post.created_at.iso8601(3),
        visual_accent_color: visual_accent_color(topic),
        counts: {
          like_count: post.like_count,
          reply_count: visible_reply_count(post),
          bookmark_count: post.bookmark_count,
        },
        actions:
          action_state(
            post,
            liked_post_ids: liked_post_ids,
            bookmarks_by_post_id: bookmarks_by_post_id,
            native_action_summary: native_action_summary,
          ),
        native_action_summary: native_action_summary,
        media: serialize_media(media, post),
      }
    end

    def native_action_summary(post)
      PostSerializer.new(post, scope: guardian, root: false).actions_summary
    end

    def visible_reply_count(post)
      visible_replies =
        if post.post_number == 1
          Post.where(topic_id: post.topic_id).where.not(post_number: post.post_number)
        else
          Post.where(id: descendant_reply_ids(post))
        end

      visible_replies
        .secured(guardian)
        .where(post_type: Post.types[:regular], deleted_at: nil, hidden: false)
        .count
    end

    def descendant_reply_ids(post)
      seen_reply_ids = Set.new
      frontier_post_ids = [post.id]

      while frontier_post_ids.present?
        reply_ids = PostReply.where(post_id: frontier_post_ids).pluck(:reply_post_id)
        reply_ids -= seen_reply_ids.to_a
        break if reply_ids.blank?

        seen_reply_ids.merge(reply_ids)
        frontier_post_ids = reply_ids
      end

      seen_reply_ids.to_a
    end

    def visual_accent_color(topic)
      color = topic&.category&.color
      return nil if color.blank?

      normalized = color.to_s.delete_prefix("#")
      return nil if normalized !~ /\A[0-9a-f]{6}\z/i

      "##{normalized.upcase}"
    end

    def serialize_media(media, post)
      if media[:provider] == "native"
        upload = post.uploads.find { |candidate| candidate.id == media.dig(:upload, :id) }
        return {
          provider: "native",
          renderability: "native",
          dedupe_key: media[:dedupe_key],
          upload_id: upload.id,
          video_url: UrlHelper.cook_url(upload.url, secure: upload.secure?, local: true),
        }
      end

      if media[:provider] == "hls" && media[:renderability] == "hls"
        return media.slice(:provider, :renderability, :dedupe_key, :hls_url)
      end

      media.slice(:provider, :renderability, :fallback, :fallback_reason, :dedupe_key, :embed_url)
    end

    def excerpt_html(post, media)
      cooked = post.cooked.to_s
      return cooked if %w[iframe_candidate hls].exclude?(media[:renderability])

      fragment = Nokogiri::HTML5.fragment(cooked)
      fragment.css("iframe").remove
      fragment.css("a[href]").each do |anchor|
        anchor.remove if provider_source_anchor?(anchor["href"], media)
      end
      fragment.traverse do |node|
        next if !node.text?

        decoded = CGI.unescapeHTML(node.content)
        node.content =
          decoded
            .gsub(IFRAME_TEXT_PATTERN, "")
            .gsub(IFRAME_OPEN_TEXT_PATTERN, "")
            .gsub(IFRAME_FRAGMENT_TEXT_PATTERN, "")
      end
      fragment.to_html
    end

    def provider_source_anchor?(href, media)
      source_url = media[:embed_url] || media[:hls_url]
      return false if href.blank? || source_url.blank?

      href.include?(URI.parse(source_url).host)
    rescue URI::InvalidURIError
      false
    end

    def action_state(post, liked_post_ids:, bookmarks_by_post_id:, native_action_summary:)
      user = guardian.user unless guardian.anonymous?
      bookmark = user && bookmarks_by_post_id[post.id]
      liked = user && liked_post_ids.include?(post.id)
      post_action_type_view = PostActionTypeView.new
      like_action = native_action_summary.find { |action| action[:id] == post_action_type_view.types[:like] }
      flag_action_ids =
        (
          post_action_type_view.notify_flag_types.values +
            post_action_type_view.additional_message_types.values
        ).uniq
      can_flag =
        native_action_summary.any? do |action|
          action[:can_act] && flag_action_ids.include?(action[:id])
        end

      {
        liked: !!liked,
        can_like: !!like_action&.dig(:can_act),
        bookmarked: bookmark.present?,
        bookmark_id: bookmark&.id,
        can_bookmark: user.present?,
        can_flag: can_flag,
        can_reply: guardian.can_create_post_on_topic?(post.topic),
        share_url: post.url,
      }
    end

    def liked_post_ids(posts)
      return Set.new if guardian.anonymous? || posts.blank?

      PostAction
        .where(
          user_id: guardian.user.id,
          post_id: posts.map(&:id),
          post_action_type_id: PostActionType.types[:like],
          deleted_at: nil,
        )
        .pluck(:post_id)
        .to_set
    end

    def bookmarks_by_post_id(posts)
      return {} if guardian.anonymous? || posts.blank?

      Bookmark
        .where(user_id: guardian.user.id, bookmarkable_type: "Post", bookmarkable_id: posts.map(&:id))
        .index_by(&:bookmarkable_id)
    end

    def apply_source_filter(scope, category_ids, tag_names)
      if category_ids.present? && tag_names.present?
        tagged_topic_ids = TopicTag.joins(:tag).where(tags: { name: tag_names }).select(:topic_id)
        scope.where("topics.category_id IN (?) OR posts.topic_id IN (?)", category_ids, tagged_topic_ids)
      elsif category_ids.present?
        scope.where(topics: { category_id: category_ids })
      else
        tagged_topic_ids = TopicTag.joins(:tag).where(tags: { name: tag_names }).select(:topic_id)
        scope.where(topic_id: tagged_topic_ids)
      end
    end

    def apply_cursor(scope, payload)
      created_at = Time.zone.iso8601(payload.fetch("created_at"))
      post_id = Integer(payload.fetch("post_id"))
      scope.where(
        "posts.created_at < :created_at OR (posts.created_at = :created_at AND posts.id < :post_id)",
        created_at: created_at,
        post_id: post_id,
      )
    end

    def next_cursor(scan_result, source)
      return nil if !scan_result.has_more || scan_result.last_scanned_post.blank?

      verifier.generate(
        {
          "created_at" => scan_result.last_scanned_post.created_at.iso8601(6),
          "post_id" => scan_result.last_scanned_post.id,
          "source_scope_digest" => source.cursor_scope_digest,
          "identity" => cursor_identity,
        },
      )
    end

    def parse_cursor(expected_digest)
      return nil if cursor.blank?

      payload = verifier.verify(cursor)
      raise INVALID_CURSOR if payload["source_scope_digest"] != expected_digest
      raise INVALID_CURSOR if payload["identity"] != cursor_identity

      payload
    rescue ActiveSupport::MessageVerifier::InvalidSignature, KeyError, ArgumentError
      raise INVALID_CURSOR
    end

    def verifier
      Rails.application.message_verifier("discourse_video_shorts_cursor")
    end

    def cursor_identity
      guardian.anonymous? ? "anonymous" : "user:#{guardian.user.id}"
    end

    def safe_positive_integer(value)
      parsed = Integer(value, exception: false)
      parsed if parsed.present? && parsed.positive?
    end
  end
end
