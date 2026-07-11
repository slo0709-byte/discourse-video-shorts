# frozen_string_literal: true

module DiscourseVideoShorts
  module Comments
    class ChangeRecorder
      SCHEMA_VERSION = 1
      CHANGE_RETENTION = 24.hours
      OPERATIONS = %w[create edit delete recover].freeze

      class InvalidCursor < StandardError
      end
      class DeltaExpired < StandardError
      end

      class << self
        def comment_channel(source_post_id)
          "/video-shorts/comments/#{source_post_id}"
        end

        def record(post:, operation:, source_post_ids: source_post_ids_for(post))
          raise ArgumentError, "unsupported comment operation" if OPERATIONS.exclude?(operation.to_s)

          source_post_ids.uniq.each do |source_post_id|
            append_change(
              source_post_id: source_post_id,
              changed_post_id: post.id,
              operation: operation.to_s,
              changed_at: Time.zone.now,
            )
          end
        end

        def source_post_ids_for(post)
          ids = []
          pending = [post.id]

          until pending.empty?
            parent_ids = PostReply.where(reply_post_id: pending).pluck(:post_id)
            pending = parent_ids - ids
            ids.concat(pending)
          end

          Post.where(id: ids).select { |candidate| DiscourseVideoShorts::SourceSelection.canonical_source?(candidate) }.map(&:id)
        end

        def descendants_of(source_post_id)
          Post.find_by_sql(
            [
              <<~SQL,
                WITH RECURSIVE video_shorts_descendants AS (
                  SELECT reply_post_id
                  FROM post_replies
                  WHERE post_id = ?
                  UNION
                  SELECT post_replies.reply_post_id
                  FROM post_replies
                  INNER JOIN video_shorts_descendants
                    ON post_replies.post_id = video_shorts_descendants.reply_post_id
                )
                SELECT posts.*
                FROM posts
                INNER JOIN video_shorts_descendants
                  ON video_shorts_descendants.reply_post_id = posts.id
                WHERE posts.post_type = ?
                ORDER BY posts.created_at ASC, posts.id ASC
              SQL
              source_post_id,
              Post.types[:regular],
            ],
          )
        end

        def visible_comments(source_post_id, guardian)
          descendants_of(source_post_id).select { |post| visible_comment?(post, guardian) }
        end

        def visible_comment?(post, guardian)
          post.deleted_at.nil? && !post.hidden? && guardian.can_see_post?(post)
        end

        def encode_snapshot_cursor(user_id:, source_post_id:, created_at:, post_id:)
          sign_cursor(
            "type" => "snapshot",
            "user_id" => user_id,
            "source_post_id" => source_post_id,
            "created_at" => created_at.iso8601(6),
            "post_id" => post_id,
          )
        end

        def decode_snapshot_cursor(cursor, user_id:, source_post_id:)
          payload = verify_cursor(cursor, user_id: user_id, source_post_id: source_post_id, type: "snapshot")
          [Time.iso8601(payload.fetch("created_at")), Integer(payload.fetch("post_id"))]
        rescue ArgumentError, KeyError
          raise InvalidCursor
        end

        def encode_change_cursor(user_id:, source_post_id:, sequence:)
          sign_cursor(
            "type" => "change",
            "user_id" => user_id,
            "source_post_id" => source_post_id,
            "sequence" => sequence,
            "issued_at" => Time.zone.now.to_i,
          )
        end

        def decode_change_cursor(cursor, user_id:, source_post_id:)
          payload = verify_cursor(cursor, user_id: user_id, source_post_id: source_post_id, type: "change")
          issued_at = Time.at(Integer(payload.fetch("issued_at")))
          raise DeltaExpired if issued_at < CHANGE_RETENTION.ago

          Integer(payload.fetch("sequence"))
        rescue ArgumentError, KeyError
          raise InvalidCursor
        end

        def authorization_lease(user_id:, source_post_id:)
          expires_at = 5.seconds.from_now
          {
            "token" => sign_cursor(
              "type" => "authorization_lease",
              "user_id" => user_id,
              "source_post_id" => source_post_id,
              "expires_at" => expires_at.to_i,
            ),
            "expires_at" => expires_at.iso8601(6),
          }
        end

        def current_sequence(source_post_id)
          connection.select_value(
            "SELECT COALESCE(MAX(sequence), 0) FROM video_shorts_comment_changes WHERE source_post_id = #{connection.quote(source_post_id)}",
          ).to_i
        end

        def changes_after(source_post_id, sequence, limit: 100)
          sanitized_sql =
            ActiveRecord::Base.send(
              :sanitize_sql_array,
              [
                "SELECT source_post_id, changed_post_id, operation, sequence, changed_at " \
                  "FROM video_shorts_comment_changes WHERE source_post_id = ? AND sequence > ? " \
                  "ORDER BY sequence ASC LIMIT ?",
                source_post_id,
                sequence,
                limit,
              ],
            )
          connection.select_all(sanitized_sql).to_a
        end

        def delta_expired?(source_post_id, sequence)
          oldest_sequence =
            connection.select_value(
              "SELECT MIN(sequence) FROM video_shorts_comment_changes WHERE source_post_id = #{connection.quote(source_post_id)}",
            )
          oldest_sequence.present? && sequence < oldest_sequence.to_i - 1
        end

        def prune!
          connection.exec_delete(
            "DELETE FROM video_shorts_comment_changes WHERE changed_at < #{connection.quote(CHANGE_RETENTION.ago)}",
            "prune video shorts comment changes",
          )
        end

        private

        def append_change(source_post_id:, changed_post_id:, operation:, changed_at:)
          sequence = nil

          ActiveRecord::Base.transaction do
            connection.execute("SELECT pg_advisory_xact_lock(#{connection.quote(source_post_id)})")
            sequence = current_sequence(source_post_id) + 1
            connection.execute(
              "INSERT INTO video_shorts_comment_changes " \
                "(source_post_id, changed_post_id, operation, sequence, changed_at) VALUES " \
                "(#{connection.quote(source_post_id)}, #{connection.quote(changed_post_id)}, " \
                "#{connection.quote(operation)}, #{connection.quote(sequence)}, #{connection.quote(changed_at)})",
            )
          end

          ActiveRecord.after_all_transactions_commit do
            publish_invalidation(source_post_id, sequence)
          end
        end

        def publish_invalidation(source_post_id, sequence)
          topic = Post.find(source_post_id).topic
          MessageBus.publish(
            comment_channel(source_post_id),
            { source_post_id: source_post_id, change_sequence: sequence },
            **topic.secure_audience_publish_messages,
          )
        end

        def sign_cursor(payload)
          cursor_verifier.generate(payload.merge("schema_version" => SCHEMA_VERSION))
        end

        def verify_cursor(cursor, user_id:, source_post_id:, type:)
          payload = cursor_verifier.verify(cursor)
          unless payload["schema_version"] == SCHEMA_VERSION &&
                   payload["type"] == type &&
                   payload["user_id"] == user_id &&
                   payload["source_post_id"] == source_post_id
            raise InvalidCursor
          end

          payload
        rescue ActiveSupport::MessageVerifier::InvalidSignature
          raise InvalidCursor
        end

        def cursor_verifier
          Rails.application.message_verifier("discourse-video-shorts-comments-v1")
        end

        def connection
          ActiveRecord::Base.connection
        end
      end
    end
  end
end
