# frozen_string_literal: true

module DiscourseVideoShorts
  module Admin
    class Diagnostics
      DEFAULT_SAMPLE_SIZE = 10
      MAX_SAMPLE_SIZE = 25
      MAX_SCAN_LIMIT = 1000
      PROVIDER_BUCKETS = %w[native hls youtube bilibili vimeo fallback unsupported unknown].freeze
      RENDERABILITY_BUCKETS = %w[native hls iframe_candidate fallback unknown].freeze

      def initialize(guardian:, sample_size: nil, scan_limit: nil)
        @guardian = guardian
        @sample_size = clamp_integer(sample_size, default: DEFAULT_SAMPLE_SIZE, min: 1, max: MAX_SAMPLE_SIZE)
        @scan_limit =
          clamp_integer(
            scan_limit,
            default: SiteSetting.video_shorts_candidate_scan_limit,
            min: 1,
            max: MAX_SCAN_LIMIT,
          )
      end

      def call
        source = source_selection
        feed = feed_result
        items = feed[:items] || []
        topics_by_id = topics_by_id_for(items)

        {
          enabled: SiteSetting.video_shorts_enabled,
          settings_summary: settings_summary(source),
          delivery: delivery_summary,
          sources: sources_summary(source),
          feed: feed_summary(feed, items),
          providers: { counts: counts_for(items, %i[media provider], buckets: PROVIDER_BUCKETS) },
          renderability: {
            counts: counts_for(items, %i[media renderability], buckets: RENDERABILITY_BUCKETS),
          },
          samples: items.map { |item| sample_for(item, topics_by_id[item[:topic_id]]) },
        }
      end

      private

      attr_reader :guardian, :sample_size, :scan_limit

      def source_selection
        @source_selection ||=
          SourceSelection.new(
            guardian: guardian,
            page_size: sample_size,
            candidate_scan_limit: scan_limit,
          ).resolve
      end

      def feed_result
        @feed_result ||=
          Feed.new(
            guardian: guardian,
            page_size: sample_size,
            scan_limit: scan_limit,
          ).call.deep_symbolize_keys
      end

      def settings_summary(source)
        {
          page_size: source.page_size,
          candidate_scan_limit: source.candidate_scan_limit,
          configured_page_size: SiteSetting.video_shorts_page_size,
          configured_candidate_scan_limit: SiteSetting.video_shorts_candidate_scan_limit,
          debug_mode: SiteSetting.video_shorts_debug_mode,
        }
      end

      def delivery_summary
        {
          native_uploads: {
            object_storage_enabled: SiteSetting.enable_s3_uploads,
            s3_cdn_url: SiteSetting.Upload.s3_cdn_url.presence,
            s3_cdn_for_all_uploads: SiteSetting.s3_use_cdn_url_for_all_uploads,
            site_cdn_url: GlobalSetting.cdn_url.presence,
            recommendation:
              "Use Discourse object storage plus a CDN for uploaded video files before high traffic.",
          },
          hls: {
            requires_https: true,
            allowed_origins: HlsOriginPolicy.configured_origins,
            media_csp_sources: HlsOriginPolicy.media_csp_sources,
            recommendation:
              "Allow each HTTPS HLS CDN origin, including its playlist and segment host, before publishing the stream.",
          },
        }
      end

      def sources_summary(source)
        {
          configured: {
            category_ids: integer_list(SiteSetting.video_shorts_source_category_ids),
            categories: categories_for(integer_list(SiteSetting.video_shorts_source_category_ids)),
            tag_names: string_list(SiteSetting.video_shorts_source_tag_names),
            tags: tags_for(string_list(SiteSetting.video_shorts_source_tag_names)),
          },
          effective: {
            category_ids: source.effective_category_ids,
            categories: categories_for(source.effective_category_ids),
            tag_names: source.effective_tag_names,
            tags: tags_for(source.effective_tag_names),
          },
          warnings: source.warnings.map { |warning| serialize_warning(warning) },
        }
      end

      def feed_summary(feed, items)
        {
          sample_size: items.length,
          requested_sample_size: sample_size,
          scan_limit: scan_limit,
          scan_limit_reached: !!feed[:scan_limit_reached],
        }
      end

      def serialize_warning(warning)
        warning.transform_keys(&:to_s).tap do |serialized|
          serialized["code"] = serialized["code"].to_s
        end
      end

      def counts_for(items, path, buckets:)
        counts =
          items.each_with_object(Hash.new(0)) do |item, totals|
            value = item.dig(*path).presence || "unknown"
            totals[value] += 1
          end

        buckets
          .index_with { |bucket| counts[bucket] }
          .merge(counts)
          .map { |name, count| { name: name, count: count } }
          .sort_by { |entry| [entry[:name].to_s] }
      end

      def sample_for(item, topic)
        {
          topic_id: item[:topic_id],
          post_id: item[:post_id],
          post_number: item[:post_number],
          title: item[:title],
          username: item[:username],
          category: category_summary(topic&.category),
          tags: topic_tags_for(topic),
          topic_url: item[:topic_url],
          post_url: item[:post_url],
          media: media_summary(item[:media] || {}),
        }
      end

      def topics_by_id_for(items)
        topic_ids = items.filter_map { |item| item[:topic_id] }.uniq
        return {} if topic_ids.blank?

        Topic.includes(:category, :tags).where(id: topic_ids).index_by(&:id)
      end

      def categories_for(category_ids)
        return [] if category_ids.blank?

        Category.where(id: category_ids).sort_by(&:id).filter_map { |category| category_summary(category) }
      end

      def category_summary(category)
        return nil if category.blank?

        {
          id: category.id,
          name: category.name,
          slug: category.slug,
        }
      end

      def tags_for(tag_names)
        return [] if tag_names.blank? || !SiteSetting.tagging_enabled

        Tag.where(name: tag_names).order(:name).map { |tag| tag_summary(tag) }
      end

      def topic_tags_for(topic)
        return [] if topic.blank?

        topic.tags.sort_by(&:name).map { |tag| tag_summary(tag) }
      end

      def tag_summary(tag)
        {
          name: tag.name,
        }
      end

      def media_summary(media)
        summary = media.slice(:provider, :renderability, :fallback, :fallback_reason)
        summary[:embed_url] = media[:embed_url] if media[:renderability] == "iframe_candidate"
        summary
      end

      def clamp_integer(value, default:, min:, max:)
        parsed = Integer(value.presence || default, exception: false) || default
        parsed.clamp(min, max)
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
end
