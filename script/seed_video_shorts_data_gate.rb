# frozen_string_literal: true

require "digest"
require "json"
require "optparse"
require "fileutils"
require "securerandom"
require "tempfile"
require Rails.root.join("plugins/discourse-video-shorts/lib/discourse_video_shorts/telemetry")

module DiscourseVideoShorts
  class DataGateSeed
    Contract = Telemetry::DataLayerContract
    PREFIX = "Video Shorts Data Gate 20260710"
    FIELD_PREFIX = "video_shorts_benchmark_"
    CLASSES = Contract::MIX.to_a.freeze

    def initialize(manifest_path:, audit_ticket: nil)
      @manifest_path = File.expand_path(manifest_path)
      @audit_ticket = audit_ticket
      @admin = User.where(admin: true).first || raise("an admin user is required")
    end

    def run
      configure_namespace!
      existing = benchmark_posts_by_ordinal
      records = Array.new(Contract::CANDIDATES)
      pending = []
      ordinal = 0

      CLASSES.each do |candidate_class, count|
        count.times do |class_index|
          attributes = attributes_for(ordinal, candidate_class.to_s, class_index, count)
          if (post = existing[ordinal])
            normalize_candidate_state!(post, attributes)
            verify_marker!(post, attributes)
            records[ordinal] = record_for(post, attributes)
          else
            pending << [ordinal, attributes]
          end
          ordinal += 1
        end
      end

      bulk_create_candidates!(pending).each do |candidate_ordinal, post, attributes|
        normalize_candidate_state!(post, attributes)
        verify_marker!(post, attributes)
        records[candidate_ordinal] = record_for(post, attributes)
      end
      raise "benchmark candidate provisioning incomplete" if records.any?(&:nil?)
      raise "benchmark namespace contains extra candidates" unless benchmark_posts_by_ordinal.length == Contract::CANDIDATES

      add_expected_identities!(records)
      identity_manifest_sha256 =
        Digest::SHA256.hexdigest(records.filter_map { |record| record[:identity_sha256] }.sort.join("\n"))
      manifest = Contract.dataset_manifest.merge(
        benchmark_user_id: @member.id,
        category_prefix: PREFIX,
        production_audit_ticket: @audit_ticket,
        records: records,
        identity_manifest_sha256:,
        expected_identity_manifest_sha256: identity_manifest_sha256,
      )
      manifest[:records_sha256] = Contract.manifest_checksum(records)
      FileUtils.mkdir_p(File.dirname(@manifest_path))
      File.write(@manifest_path, JSON.pretty_generate(manifest) << "\n")
      Contract.verify_manifest!(JSON.parse(File.read(@manifest_path)))
      puts JSON.generate(manifest_path: @manifest_path, manifest_sha256: Digest::SHA256.file(@manifest_path).hexdigest, benchmark_user_id: @member.id, candidates: records.length, production_audit_ticket: @audit_ticket)
    end

    private


    def configure_namespace!
      SiteSetting.authorized_extensions = (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
      SiteSetting.video_shorts_enabled = true
      SiteSetting.tagging_enabled = true
      @member = User.find_by(username: "vs_bench_20260710") || User.create!(username: "vs_bench_20260710", email: "video-shorts-benchmark-20260710@example.test", name: PREFIX, password: SecureRandom.base58(32), active: true)
      @member.activate
      @public_category = Category.find_by(name: "#{PREFIX} Public") || Category.create!(name: "#{PREFIX} Public", user: @admin)
      @neutral_category = Category.find_by(name: "#{PREFIX} Tag Only") || Category.create!(name: "#{PREFIX} Tag Only", user: @admin)
      @private_group = Group.find_by(name: "vs_bench_private") || Group.create!(name: "vs_bench_private")
      @private_category = Category.find_by(name: "#{PREFIX} Private") || Category.create!(name: "#{PREFIX} Private", user: @admin, read_restricted: true)
      @private_category.set_permissions(@private_group => :full)
      @private_category.save!
      @tag = Tag.find_by(name: "vs-gate-20260710") || Tag.create!(name: "vs-gate-20260710")
      SiteSetting.video_shorts_source_category_ids = @public_category.id.to_s
      SiteSetting.video_shorts_source_tag_names = @tag.name
      policy = DiscourseVideoShorts::OriginPolicy.current
      policy.update!(origins: (policy.origins + ["https://media.example.test"]).uniq, external_media_enabled: true, actor: @admin)
    end

    def bulk_create_candidates!(entries)
      created = []

      entries.each_slice(200) do |batch|
        started_at = Time.current
        topic_rows =
          batch.map do |candidate_ordinal, attributes|
            title = "#{PREFIX} Candidate #{candidate_ordinal}"
            {
              title: title,
              fancy_title: title,
              slug: title.downcase.gsub(/[^a-z0-9]+/, "-").delete_suffix("-"),
              user_id: @admin.id,
              last_post_user_id: @admin.id,
              category_id: candidate_category(attributes).id,
              visible: attributes[:candidate_class] != "private_not_visible",
              archetype: Archetype.default,
              posts_count: attributes[:placement] == "first" ? 1 : 2,
              highest_post_number: attributes[:placement] == "first" ? 1 : 2,
              created_at: started_at,
              updated_at: started_at,
              bumped_at: started_at,
              last_posted_at: started_at,
            }
          end
        topic_ids = Topic.insert_all!(topic_rows, returning: %w[id]).rows.flatten

        post_rows = []
        candidate_post_numbers = {}
        batch.each_with_index do |(_candidate_ordinal, attributes), index|
          topic_id = topic_ids.fetch(index)
          raw, upload = candidate_body(attributes)
          raise "bulk candidate unexpectedly requires an upload" if upload

          raw = exact_size(raw, attributes[:body_kib] * 1024)
          created_at = started_at + index.fdiv(1000)
          if attributes[:placement] == "reply"
            post_rows << {
              topic_id: topic_id,
              user_id: @admin.id,
              post_number: 1,
              post_type: Post.types[:small_action],
              raw: "Benchmark reply scaffold",
              cooked: "<p>Benchmark reply scaffold</p>",
              hidden: false,
              deleted_at: nil,
              created_at: created_at,
              updated_at: created_at,
              last_version_at: created_at,
            }
          end

          post_number = attributes[:placement] == "first" ? 1 : 2
          deleted_at =
            started_at if attributes[:candidate_class] == "deleted_or_hidden" && attributes[:class_index].odd?
          post_rows << {
            topic_id: topic_id,
            user_id: @admin.id,
            post_number: post_number,
            post_type: Post.types[:regular],
            raw: raw,
            cooked: raw,
            hidden:
              attributes[:candidate_class] == "deleted_or_hidden" && attributes[:class_index].even?,
            deleted_at: deleted_at,
            created_at: created_at,
            updated_at: created_at,
            last_version_at: created_at,
          }
          candidate_post_numbers[topic_id] = post_number
        end

        Post.insert_all!(post_rows)
        conditions =
          topic_ids.map do |topic_id|
            "(topic_id = #{Integer(topic_id)} AND post_number = #{candidate_post_numbers.fetch(topic_id)})"
          end
        candidate_posts =
          Post.where(topic_id: topic_ids).where(conditions.join(" OR ")).index_by(&:topic_id)

        marker_rows = []
        tag_rows = []
        deleted_post_ids = []
        batch.each_with_index do |(candidate_ordinal, attributes), index|
          topic_id = topic_ids.fetch(index)
          post = candidate_posts.fetch(topic_id)
          marker_for(attributes).each do |key, value|
            marker_rows << {
              post_id: post.id,
              name: "#{FIELD_PREFIX}#{key}",
              value: value,
              created_at: started_at,
              updated_at: started_at,
            }
          end
          if attributes[:source_primary] == "tag" || attributes[:double_match]
            tag_rows << {
              topic_id: topic_id,
              tag_id: @tag.id,
              created_at: started_at,
              updated_at: started_at,
            }
          end
          created << [candidate_ordinal, post, attributes]
          deleted_post_ids << post.id if attributes[:candidate_class] == "deleted_or_hidden" && attributes[:class_index].odd?
        end
        PostCustomField.insert_all!(marker_rows)
        TopicTag.insert_all!(tag_rows) if tag_rows.any?
        Post.where(id: deleted_post_ids).update_all(deleted_at: started_at) if deleted_post_ids.any?
      end

      posts =
        Post
          .with_deleted
          .where(id: created.map { |(_, post, _)| post.id })
          .includes(:topic, :user, :uploads)
          .index_by(&:id)
      created.map { |ordinal, post, attributes| [ordinal, posts.fetch(post.id), attributes] }
    end

    def marker_for(attributes)
      {
        "namespace" => Contract::NAMESPACE,
        "seed" => Contract::SEED.to_s,
        "ordinal" => attributes[:ordinal].to_s,
        "class" => attributes[:candidate_class],
        "placement" => attributes[:placement],
        "source_primary" => attributes[:source_primary],
        "double_match" => attributes[:double_match].to_s,
        "body_kib" => attributes[:body_kib].to_s,
      }
    end
    def benchmark_posts_by_ordinal
      fields =
        PostCustomField.where(
          name: "#{FIELD_PREFIX}namespace",
          value: Contract::NAMESPACE,
        )
      posts =
        Post
          .with_deleted
          .where(id: fields.map(&:post_id))
          .includes(:topic)
          .index_by(&:id)
      fields.to_h do |field|
        post = posts.fetch(field.post_id)
        [post.custom_fields.fetch("#{FIELD_PREFIX}ordinal").to_i, post]
      end
    end

    def attributes_for(ordinal, candidate_class, class_index, class_count)
      placement = class_index < (class_count * 0.6).to_i ? "first" : "reply"
      body_kib = ordinal < 7_000 ? 2 : (ordinal < 9_500 ? 20 : 100)
      source_primary = ordinal < 5_000 ? "category" : "tag"
      {
        ordinal:,
        candidate_class:,
        placement:,
        body_kib:,
        source_primary:,
        double_match: (ordinal % 5).zero?,
        class_index:,
      }
    end

    def create_candidate!(attributes)
      category = candidate_category(attributes)
      raw, upload = candidate_body(attributes)
      raw = exact_size(raw, attributes[:body_kib] * 1024)
      topic = nil
      post =
        if attributes[:placement] == "first"
          created = PostCreator.create!(@admin, title: "#{PREFIX} Candidate #{attributes[:ordinal]}", raw:, category: category.id, skip_validations: true)
          topic = created.topic
          created
        else
          scaffold = PostCreator.create!(@admin, title: "#{PREFIX} Scaffold #{attributes[:ordinal]}", raw: "Benchmark reply scaffold", category: category.id, skip_validations: true)
          scaffold.update!(post_type: Post.types[:small_action])
          topic = scaffold.topic
          PostCreator.create!(@admin, topic_id: topic.id, raw:, skip_validations: true)
        end
      TopicTag.find_or_create_by!(topic:, tag: @tag) if attributes[:source_primary] == "tag" || attributes[:double_match]
      UploadReference.find_or_create_by!(upload:, target: post) if upload
      topic.update_columns(visible: false) if attributes[:candidate_class] == "private_not_visible"
      marker_for(attributes).each do |key, value|
        post.custom_fields["#{FIELD_PREFIX}#{key}"] = value
      end
      post.save_custom_fields
      if attributes[:candidate_class] == "deleted_or_hidden"
        attributes[:class_index].even? ? post.update!(hidden: true) : post.trash!(@admin)
      end
      post
    end

    def candidate_category(attributes)
      source_category(attributes)
    end

    def normalize_candidate_state!(post, attributes)
      if attributes[:candidate_class] == "private_not_visible"
        expected_category_id = source_category(attributes).id
        if post.topic.category_id != expected_category_id || post.topic.visible?
          post.topic.update_columns(
            category_id: expected_category_id,
            visible: false,
          )
          post.topic.reload
        end
      end

      return unless attributes[:candidate_class] == "deleted_or_hidden"

      if attributes[:class_index].even?
        post.update_columns(hidden: true, deleted_at: nil) unless post.hidden? && post.deleted_at.nil?
      elsif post.deleted_at.nil?
        post.update_columns(hidden: false, deleted_at: Time.current)
      end
      post.reload
    end
    def source_category(attributes)
      attributes[:source_primary] == "category" || attributes[:double_match] ? @public_category : @neutral_category
    end

    def candidate_body(attributes)
      klass = attributes[:candidate_class]
      index = attributes[:class_index]
      return ["No video media for benchmark candidate #{index}", nil] if klass == "visible_without_media" || klass == "private_not_visible" || klass == "deleted_or_hidden"
      return ["https://www.youtube.com/watch?v=00000000000", nil] if klass == "visible_duplicate_identity"
      if klass == "visible_malformed_or_unapproved"
        bad = ["http://media.example.test/bad.mp4", "https://unapproved.example.test/bad.mp4", "https://www.youtube.com/watch?v=bad"]
        return [bad[index % bad.length], nil]
      end

      kind = Contract::VALID_MEDIA_KINDS[index / 300]
      kind_index = index % 300
      case kind
      when "bilibili"
        ["https://www.bilibili.com/video/BV#{kind_index.to_s(36).upcase.rjust(10, "0")}", nil]
      when "youtube"
        ["https://www.youtube.com/watch?v=#{kind_index.to_s(36).rjust(11, "0")}", nil]
      when "upload_mp4"
        upload = benchmark_upload(kind_index)
        ["Uploaded benchmark MP4 #{upload.short_url}", upload]
      when "external_mp4"
        ["https://media.example.test/videos/#{kind_index}.mp4", nil]
      when "external_hls"
        ["https://media.example.test/videos/#{kind_index}.m3u8", nil]
      end
    end

    def benchmark_upload(index)
      filename = "video-shorts-data-gate-20260710-#{index}.mp4"
      Upload.find_by(original_filename: filename) || begin
        fixture = Rails.root.join("plugins/discourse-video-shorts/spec/fixtures/files/tiny-video.mp4")
        Tempfile.create(["video-shorts-data-gate-", ".mp4"]) do |file|
          file.binmode
          file.write(File.binread(fixture))
          file.write("benchmark-#{index}")
          file.flush
          UploadCreator.new(File.open(file.path), filename, skip_validations: true).create_for(@admin.id)
        end
      end
    end

    def exact_size(prefix, bytes)
      raise "candidate body exceeds requested size" if prefix.bytesize > bytes

      remaining = bytes - prefix.bytesize
      prefix + (" x" * (remaining / 2)) + (remaining.odd? ? "x" : "")
    end

    def verify_marker!(post, attributes)
      fields = post.custom_fields
      expected = marker_for(attributes)
      expected.each do |name, value|
        raise "candidate ordinal #{attributes[:ordinal]} #{name} marker drift" unless fields["#{FIELD_PREFIX}#{name}"] == value
      end
      raise "candidate ordinal #{attributes[:ordinal]} body drift" unless post.raw.to_s.bytesize == attributes[:body_kib] * 1024
      actual_placement = post.post_number == 1 ? "first" : "reply"
      raise "candidate ordinal #{attributes[:ordinal]} placement drift" unless actual_placement == attributes[:placement]

      category_match = post.topic.category_id == @public_category.id
      tag_match = post.topic.tags.where(id: @tag.id).exists?
      primary_match = attributes[:source_primary] == "category" ? category_match : tag_match
      raise "candidate ordinal #{attributes[:ordinal]} primary source drift" unless primary_match
      raise "candidate ordinal #{attributes[:ordinal]} double-source drift" unless attributes[:double_match] == (category_match && tag_match)

      if attributes[:candidate_class] == "deleted_or_hidden"
        expected_state = attributes[:class_index].even? ? "hidden" : "deleted"
        actual_state = post.deleted_at ? "deleted" : (post.hidden? ? "hidden" : nil)
        raise "candidate ordinal #{attributes[:ordinal]} deleted/hidden drift" unless actual_state == expected_state
      end

      if attributes[:candidate_class] == "private_not_visible"
        raise "candidate ordinal #{attributes[:ordinal]} private visibility drift" if post.topic.visible?
      end
    end

    def record_for(post, attributes)
      {
        post_id: post.id,
        ordinal: attributes[:ordinal],
        candidate_class: attributes[:candidate_class],
        placement: attributes[:placement],
        source_primary: attributes[:source_primary],
        double_match: attributes[:double_match],
        body_kib: attributes[:body_kib],
        body_bytes: attributes[:body_kib] * 1024,
        state: attributes[:candidate_class] == "deleted_or_hidden" ? (attributes[:class_index].even? ? "hidden" : "deleted") : nil,
      }
    end

    def add_expected_identities!(records)
      posts = Post.unscoped.where(id: records.map { |record| record[:post_id] }).includes(:uploads).index_by(&:id)
      guardian = Guardian.new(@member)
      records.select { |record| record[:candidate_class] == "visible_unique_valid_media" }.each_with_index do |record, index|
        media = MediaExtractor.extract_media_for_visible_post(posts.fetch(record[:post_id]), guardian)
        expected_kind = Contract::VALID_MEDIA_KINDS[index / 300]
        raise "valid media extraction drift for post #{record[:post_id]}" unless media&.fetch(:kind) == expected_kind
        record[:media_kind] = expected_kind
        record[:identity_sha256] = Digest::SHA256.hexdigest(media.fetch(:identity))
      end
    end
  end
end

options = { manifest_path: Rails.root.join("tmp/video-shorts-data-gate-20260710-manifest.json").to_s, allow_production: false, audit_ticket: nil }
OptionParser.new do |parser|
  parser.on("--manifest PATH") { |value| options[:manifest_path] = value }
  parser.on("--allow-production") { options[:allow_production] = true }
  parser.on("--audit-ticket TICKET") { |value| options[:audit_ticket] = value }
end.parse!
if Rails.env.production? && !(options[:allow_production] && options[:audit_ticket].to_s.match?(/\A[A-Z][A-Z0-9_-]+-\d+\z/))
  raise "production seeding is refused; --allow-production and a traceable --audit-ticket are both required"
end

DiscourseVideoShorts::DataGateSeed.new(manifest_path: options[:manifest_path], audit_ticket: options[:audit_ticket]).run
