# frozen_string_literal: true

require "cgi"
require "digest"
require "nokogiri"
require "json"
require "securerandom"

module DiscourseVideoShorts
  class Feed
    INVALID_CURSOR = Class.new(StandardError)
    SCHEMA_VERSION = 1
    MAX_PAGE_SIZE = 20
    MAX_SCAN_LIMIT = 500
    CURSOR_STATE_TTL = 1.hour
    CURSOR_STATE_KEY_PREFIX = "discourse-video-shorts:cursor-state:"
    IFRAME_TEXT_PATTERN = %r{<iframe\b[^>]*>.*?</iframe>}im
    IFRAME_OPEN_TEXT_PATTERN = %r{<iframe\b[^>]*>}im
    IFRAME_FRAGMENT_TEXT_PATTERN = %r{<iframe\b.*}im

    ScanResult = Data.define(:items, :last_scanned_post, :has_more, :scan_limit_reached)

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
      @policy_snapshot = DiscourseVideoShorts::Policy::Snapshot.current
      source = source_selection
      bindings = cursor_bindings(source)
      revision = feed_revision(bindings)
      cursor_payload = parse_cursor(bindings)
      candidates = load_candidates(source, cursor_payload)
      seen_identities = cursor_seen_identities(cursor_payload)
      scan_result = scan_candidates(candidates, source, seen_identities)

      {
        schema_version: SCHEMA_VERSION,
        feed_revision: revision,
        items: scan_result.items,
        next_cursor: next_cursor(scan_result, revision, bindings, seen_identities),
        scan: {
          candidates_scanned: scan_result.last_scanned_post ? candidates_scanned(candidates, scan_result) : 0,
          scan_limit_reached: scan_result.scan_limit_reached,
          end_reached: !scan_result.has_more,
        },
      }
    end

    private

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
          .where(post_type: Post.types[:regular], deleted_at: nil)
          .where(topics: { deleted_at: nil })
      scope = apply_source_filter(scope, source.effective_category_ids, source.effective_tag_names)
      scope = apply_cursor(scope, cursor_payload) if cursor_payload.present?
      scope.order("posts.created_at DESC, posts.id DESC").limit(source.candidate_scan_limit + 1).to_a
    end

    def scan_candidates(candidates, source, seen_identities)
      extracted = []
      identities = seen_identities.to_set
      last_scanned_post = nil

      candidates.first(source.candidate_scan_limit).each_with_index do |post, index|
        last_scanned_post = post
        next unless guardian.can_see?(post.topic) && guardian.can_see?(post)

        media =
          MediaExtractorCache.extract_media_for_visible_post(
            post,
            guardian,
            policy_snapshot: policy_snapshot,
          )
        next if media.blank?

        identity = media[:identity].to_s
        next if identity.blank? || identities.include?(identity)

        identities << identity
        extracted << [post, media]
        if extracted.length >= source.page_size
          return ScanResult.new(
            items: serialize_items(extracted),
            last_scanned_post: last_scanned_post,
            has_more: candidates[index + 1].present?,
            scan_limit_reached: false,
          )
        end
      end

      has_more = candidates.length > source.candidate_scan_limit
      ScanResult.new(
        items: serialize_items(extracted),
        last_scanned_post: last_scanned_post,
        has_more: has_more,
        scan_limit_reached: has_more && last_scanned_post.present?,
      )
    end

    def candidates_scanned(candidates, scan_result)
      candidates.index { |post| post.id == scan_result.last_scanned_post.id }.to_i + 1
    end

    def serialize_items(extracted)
      posts = extracted.map(&:first)
      liked_post_ids = liked_post_ids(posts)
      bookmarks_by_post_id = bookmarks_by_post_id(posts)
      visible_reply_counts_by_post_id = visible_reply_counts(posts)

      extracted.map do |post, media|
        serialize_item(
          post,
          media,
          liked_post_ids: liked_post_ids,
          bookmarks_by_post_id: bookmarks_by_post_id,
          visible_reply_counts_by_post_id: visible_reply_counts_by_post_id,
          native_action_summary: native_action_summary(post),
        )
      end
    end

    def serialize_item(
      post,
      media,
      liked_post_ids:,
      bookmarks_by_post_id:,
      visible_reply_counts_by_post_id:,
      native_action_summary:
    )
      topic = post.topic
      {
        topic_id: topic.id,
        post_id: post.id,
        post_number: post.post_number,
        topic_url: topic.relative_url,
        post_url: post.url,
        title: topic.title,
        excerpt: excerpt_text(post, media),
        username: post.user&.username,
        avatar_template: post.user&.avatar_template,
        created_at: post.created_at.iso8601(3),
        counts: {
          like_count: post.like_count,
          reply_count: visible_reply_counts_by_post_id.fetch(post.id, 0),
          bookmark_count: post.bookmark_count,
        },
        actions: action_state(post, liked_post_ids:, bookmarks_by_post_id:, native_action_summary:),
        media: serialize_media(media),
      }
    end

    def native_action_summary(post)
      PostSerializer.new(post, scope: guardian, root: false).actions_summary
    end

    def visible_reply_counts(posts)
      return {} if posts.blank?

      post_ids = posts.map(&:id)
      quoted_post_ids = post_ids.map { |post_id| ActiveRecord::Base.connection.quote(post_id) }.join(",")
      rows =
        ActiveRecord::Base.connection.select_rows(
          <<~SQL,
            WITH RECURSIVE video_shorts_descendants(source_post_id, reply_post_id) AS (
              SELECT post_id, reply_post_id
              FROM post_replies
              WHERE post_id IN (#{quoted_post_ids})
              UNION
              SELECT descendants.source_post_id, post_replies.reply_post_id
              FROM post_replies
              INNER JOIN video_shorts_descendants descendants
                ON post_replies.post_id = descendants.reply_post_id
            )
            SELECT source_post_id, reply_post_id
            FROM video_shorts_descendants
          SQL
        )
      return post_ids.index_with(0) if rows.blank?

      visible_reply_ids =
        Post
          .where(id: rows.map(&:last).uniq)
          .secured(guardian)
          .where(post_type: Post.types[:regular], deleted_at: nil, hidden: false)
          .pluck(:id)
          .to_set
      counts = post_ids.index_with(0)
      rows.each do |source_post_id, reply_post_id|
        counts[source_post_id.to_i] += 1 if visible_reply_ids.include?(reply_post_id.to_i)
      end
      counts
    end

    def serialize_media(media)
      serialized = {
        kind: media.fetch(:kind),
        identity: media.fetch(:identity),
        required_origins: Array(media[:required_origins]),
        policy_revision: media[:policy_revision],
        fallback_reason: media[:fallback_reason],
      }
      serialized[:url] = media[:url] if media[:url].present?
      serialized
    end

    def excerpt_text(post, media)
      excerpt = PrettyText.excerpt(excerpt_html(post, media), 220, keep_emoji_images: false)
      Nokogiri::HTML5.fragment(excerpt).text.squish
    end

    def excerpt_html(post, media)
      cooked = post.cooked.to_s
      return cooked if %w[bilibili youtube].exclude?(media[:kind])

      fragment = Nokogiri::HTML5.fragment(cooked)
      fragment.css("iframe").remove
      fragment.traverse do |node|
        next unless node.text?

        node.content = CGI.unescapeHTML(node.content).gsub(IFRAME_TEXT_PATTERN, "").gsub(IFRAME_OPEN_TEXT_PATTERN, "").gsub(IFRAME_FRAGMENT_TEXT_PATTERN, "")
      end
      fragment.to_html
    end

    def action_state(post, liked_post_ids:, bookmarks_by_post_id:, native_action_summary:)
      user = guardian.user unless guardian.anonymous?
      like_action = native_action_summary.find { |action| action[:id] == PostActionTypeView.new.types[:like] }
      action_types = PostActionTypeView.new
      flag_action_ids = (action_types.notify_flag_types.values + action_types.additional_message_types.values).uniq
      {
        liked: !guardian.anonymous? && liked_post_ids.include?(post.id),
        bookmarked: !guardian.anonymous? && bookmarks_by_post_id.key?(post.id),
        can_like: !!like_action&.dig(:can_act),
        can_bookmark: user.present?,
        can_reply: guardian.can_create_post_on_topic?(post.topic),
        can_flag: native_action_summary.any? { |action| action[:can_act] && flag_action_ids.include?(action[:id]) },
        share_url: post.url,
      }
    end

    def liked_post_ids(posts)
      return Set.new if guardian.anonymous? || posts.blank?

      PostAction.where(user_id: guardian.user.id, post_id: posts.map(&:id), post_action_type_id: PostActionType.types[:like], deleted_at: nil).pluck(:post_id).to_set
    end

    def bookmarks_by_post_id(posts)
      return {} if guardian.anonymous? || posts.blank?

      Bookmark.where(user_id: guardian.user.id, bookmarkable_type: "Post", bookmarkable_id: posts.map(&:id)).index_by(&:bookmarkable_id)
    end

    def apply_source_filter(scope, category_ids, tag_names)
      tagged_topic_ids = TopicTag.joins(:tag).where(tags: { name: tag_names }).select(:topic_id)
      return scope.where("topics.category_id IN (?) OR posts.topic_id IN (?)", category_ids, tagged_topic_ids) if category_ids.present? && tag_names.present?
      return scope.where(topics: { category_id: category_ids }) if category_ids.present?

      scope.where(topic_id: tagged_topic_ids)
    end

    def apply_cursor(scope, payload)
      created_at = Time.zone.iso8601(payload.fetch("created_at"))
      post_id = Integer(payload.fetch("post_id"))
      scope.where("posts.created_at < :created_at OR (posts.created_at = :created_at AND posts.id < :post_id)", created_at:, post_id:)
    end

    def next_cursor(scan_result, revision, bindings, prior_seen_identities)
      return nil unless scan_result.has_more && scan_result.last_scanned_post.present?

      state_id = SecureRandom.hex(32)
      seen_identities =
        (prior_seen_identities + scan_result.items.map { |item| item.dig(:media, :identity) }).uniq
      Discourse.cache.write(
        cursor_state_key(state_id),
        JSON.generate(seen_identities),
        expires_in: CURSOR_STATE_TTL,
      )

      verifier.generate(
        {
          "created_at" => scan_result.last_scanned_post.created_at.iso8601(6),
          "post_id" => scan_result.last_scanned_post.id,
          "feed_revision" => revision,
          "bindings" => bindings,
          "state_id" => state_id,
        },
      )
    end

    def parse_cursor(expected_bindings)
      return {} if cursor.blank?

      payload = verifier.verify(cursor)
      raise INVALID_CURSOR unless payload.is_a?(Hash)
      raise INVALID_CURSOR unless payload["bindings"] == expected_bindings
      raise INVALID_CURSOR unless payload["feed_revision"] == feed_revision(expected_bindings)
      raise INVALID_CURSOR unless payload["state_id"].is_a?(String) && payload["state_id"].match?(/\A[0-9a-f]{64}\z/)

      Time.zone.iso8601(payload.fetch("created_at"))
      Integer(payload.fetch("post_id"))
      payload
    rescue ActiveSupport::MessageVerifier::InvalidSignature, KeyError, ArgumentError, TypeError
      raise INVALID_CURSOR
    end
    def cursor_seen_identities(payload)
      return [] if payload.blank?

      raw_state = Discourse.cache.read(cursor_state_key(payload.fetch("state_id")))
      seen_identities = JSON.parse(raw_state)
      raise INVALID_CURSOR unless seen_identities.is_a?(Array)
      raise INVALID_CURSOR unless seen_identities.all? { |identity| identity.is_a?(String) }

      seen_identities
    rescue JSON::ParserError, KeyError, TypeError
      raise INVALID_CURSOR
    end

    def cursor_state_key(state_id)
      "#{CURSOR_STATE_KEY_PREFIX}#{state_id}"
    end

    def cursor_bindings(source)
      {
        "schema_version" => SCHEMA_VERSION,
        "effective_category_ids" => source.effective_category_ids,
        "effective_tag_names" => source.effective_tag_names,
        "source_scope_digest" => source.cursor_scope_digest,
        "identity" => cursor_identity,
        "policy_revision" => policy_snapshot.revision,
        "canary_digest" => canary_digest,
      }
    end

    def feed_revision(bindings)
      Digest::SHA256.hexdigest(JSON.generate(bindings))
    end

    def policy_snapshot
      @policy_snapshot
    end

    def canary_digest
      return DiscourseVideoShorts::Canary.digest_for(guardian) if defined?(DiscourseVideoShorts::Canary)

      "all-users"
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
