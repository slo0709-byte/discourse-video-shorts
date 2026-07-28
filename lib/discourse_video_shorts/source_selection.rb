# frozen_string_literal: true

require "digest"
require "json"

module DiscourseVideoShorts
  class SourceSelection
    SCHEMA_VERSION = 1
    REGULAR_POST_FILTER_VERSION = "regular-post-v1"
    CATEGORY_MATCH_VERSION = "exact-category-v1"
    SOURCE_MATCH_VERSION = "topic-category-or-tag-v1"

    Result =
      Data.define(
        :posts,
        :warnings,
        :effective_category_ids,
        :effective_tag_names,
        :page_size,
        :candidate_scan_limit,
        :source_scope_digest,
        :source_scope_digest_input,
        :cursor_scope_digest,
      )

    def initialize(guardian:, page_size: nil, candidate_scan_limit: nil, metadata_only: false)
      @guardian = guardian
      @requested_page_size = page_size
      @requested_candidate_scan_limit = candidate_scan_limit
      @metadata_only = metadata_only
    end

    def resolve
      category_sources = resolve_category_sources
      tag_sources = resolve_tag_sources
      warnings = staff_warnings(category_sources:, tag_sources:)
      posts =
        if metadata_only
          []
        else
          candidate_posts(category_sources.effective_ids, tag_sources.effective_names)
        end
      digest_input =
        source_scope_digest_input(
          category_ids: category_sources.effective_ids,
          tag_names: tag_sources.effective_names,
        )
      cursor_digest_input =
        source_scope_digest_input(
          category_ids: category_sources.configured_ids,
          tag_names: tag_sources.configured_names,
        )

      Result.new(
        posts: posts,
        warnings: warnings,
        effective_category_ids: category_sources.effective_ids,
        effective_tag_names: tag_sources.effective_names,
        page_size: resolved_page_size,
        candidate_scan_limit: resolved_candidate_scan_limit,
        source_scope_digest: Digest::SHA256.hexdigest(JSON.generate(digest_input)),
        source_scope_digest_input: digest_input,
        cursor_scope_digest: Digest::SHA256.hexdigest(JSON.generate(cursor_digest_input)),
      )
    end

    private

    SourceResolution =
      Data.define(
        :configured,
        :configured_ids,
        :configured_names,
        :effective_ids,
        :effective_names,
        :invalid_ids,
        :invalid_names,
        :inaccessible_ids,
        :tagging_disabled,
      )

    attr_reader :guardian, :requested_page_size, :requested_candidate_scan_limit, :metadata_only

    def resolve_category_sources
      configured_ids = integer_list(SiteSetting.video_shorts_source_category_ids)
      categories = Category.where(id: configured_ids).to_a
      categories_by_id = categories.index_by(&:id)
      invalid_ids = configured_ids.reject { |id| categories_by_id.key?(id) }
      visible_categories = categories.select { |category| guardian.can_see_category?(category) }
      inaccessible_ids = categories.map(&:id) - visible_categories.map(&:id)

      SourceResolution.new(
        configured: configured_ids.present?,
        configured_ids: configured_ids.sort,
        configured_names: [],
        effective_ids: visible_categories.map(&:id).sort,
        effective_names: [],
        invalid_ids: invalid_ids,
        invalid_names: [],
        inaccessible_ids: inaccessible_ids,
        tagging_disabled: false,
      )
    end

    def resolve_tag_sources
      configured_names = string_list(SiteSetting.video_shorts_source_tag_names)
      if configured_names.blank?
        return empty_tag_resolution(configured: false, tagging_disabled: false)
      end

      if !SiteSetting.tagging_enabled
        return empty_tag_resolution(configured: true, tagging_disabled: true)
      end

      tags = Tag.where(name: configured_names).pluck(:name)
      effective_names = tags.sort

      SourceResolution.new(
        configured: true,
        configured_ids: [],
        configured_names: configured_names,
        effective_ids: [],
        effective_names: effective_names,
        invalid_ids: [],
        invalid_names: configured_names - effective_names,
        inaccessible_ids: [],
        tagging_disabled: false,
      )
    end

    def empty_tag_resolution(configured:, tagging_disabled:)
      SourceResolution.new(
        configured: configured,
        configured_ids: [],
        configured_names: [],
        effective_ids: [],
        effective_names: [],
        invalid_ids: [],
        invalid_names: [],
        inaccessible_ids: [],
        tagging_disabled: tagging_disabled,
      )
    end

    def staff_warnings(category_sources:, tag_sources:)
      return [] if !guardian.is_staff?

      warnings = []
      if !category_sources.configured && !tag_sources.configured
        warnings << { code: :no_source_settings }
      end

      if category_sources.invalid_ids.present?
        warnings << { code: :invalid_category_ids, ids: category_sources.invalid_ids }
      end

      if category_sources.inaccessible_ids.present?
        warnings << { code: :inaccessible_category_ids, ids: category_sources.inaccessible_ids }
      end

      warnings << { code: :tagging_disabled } if tag_sources.tagging_disabled

      if tag_sources.invalid_names.present?
        warnings << { code: :invalid_tag_names, names: tag_sources.invalid_names }
      end

      if (category_sources.configured || tag_sources.configured) &&
           category_sources.effective_ids.blank? && tag_sources.effective_names.blank?
        warnings << { code: :no_effective_sources }
      end

      warnings
    end

    def candidate_posts(category_ids, tag_names)
      return [] if category_ids.blank? && tag_names.blank?

      posts =
        Post
          .joins(:topic)
          .includes(topic: :tags)
          .where(post_type: Post.types[:regular])
          .where(deleted_at: nil)
          .where(topics: { deleted_at: nil })

      posts = apply_source_filter(posts, category_ids, tag_names)

      posts
        .order("posts.created_at DESC, posts.id DESC")
        .limit(resolved_candidate_scan_limit)
        .select { |post| guardian.can_see?(post.topic) && guardian.can_see?(post) }
    end

    def apply_source_filter(posts, category_ids, tag_names)
      if category_ids.present? && tag_names.present?
        tagged_topic_ids = TopicTag.joins(:tag).where(tags: { name: tag_names }).select(:topic_id)
        posts.where("topics.category_id IN (?) OR posts.topic_id IN (?)", category_ids, tagged_topic_ids)
      elsif category_ids.present?
        posts.where(topics: { category_id: category_ids })
      else
        tagged_topic_ids = TopicTag.joins(:tag).where(tags: { name: tag_names }).select(:topic_id)
        posts.where(topic_id: tagged_topic_ids)
      end
    end

    def resolved_page_size
      value = requested_page_size.presence || SiteSetting.video_shorts_page_size
      clamp_integer(value, min: 1, max: 50)
    end

    def resolved_candidate_scan_limit
      value = requested_candidate_scan_limit.presence || SiteSetting.video_shorts_candidate_scan_limit
      clamp_integer(value, min: 1, max: 1000)
    end

    def source_scope_digest_input(category_ids:, tag_names:)
      {
        schema_version: SCHEMA_VERSION,
        video_shorts_enabled: SiteSetting.video_shorts_enabled,
        category_ids: category_ids,
        tag_names: tag_names,
        provider_settings: ProviderPolicy.settings_snapshot,
        tagging_enabled: SiteSetting.tagging_enabled,
        category_match: CATEGORY_MATCH_VERSION,
        source_match: SOURCE_MATCH_VERSION,
        post_filter: REGULAR_POST_FILTER_VERSION,
      }
    end

    def clamp_integer(value, min:, max:)
      value.to_i.clamp(min, max)
    end

    def integer_list(value)
      value.to_s.split("|").filter_map do |item|
        stripped = item.strip
        next if stripped.blank?

        Integer(stripped, exception: false)
      end.uniq
    end

    def string_list(value)
      value.to_s.split("|").filter_map do |item|
        stripped = item.strip.downcase
        stripped.presence
      end.uniq.sort
    end
  end
end
