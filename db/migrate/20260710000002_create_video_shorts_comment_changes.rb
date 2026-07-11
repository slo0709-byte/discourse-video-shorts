# frozen_string_literal: true

class CreateVideoShortsCommentChanges < ActiveRecord::Migration[7.0]
  def change
    create_table :video_shorts_comment_changes do |t|
      t.bigint :source_post_id, null: false
      t.bigint :changed_post_id, null: false
      t.string :operation, null: false
      t.bigint :sequence, null: false
      t.datetime :changed_at, null: false
    end

    add_index :video_shorts_comment_changes,
              %i[source_post_id sequence],
              unique: true,
              name: "index_video_shorts_comment_changes_on_source_and_sequence"
    add_index :video_shorts_comment_changes,
              %i[source_post_id changed_at],
              name: "index_video_shorts_comment_changes_on_source_and_changed_at"
    add_index :video_shorts_comment_changes,
              :changed_post_id,
              name: "index_video_shorts_comment_changes_on_changed_post"
  end
end
