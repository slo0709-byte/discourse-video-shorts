# frozen_string_literal: true

class CreateVideoShortsPolicies < ActiveRecord::Migration[7.0]
  def up
    create_table :video_shorts_origin_policies do |t|
      t.boolean :external_media_enabled, null: false, default: false
      t.integer :revision, null: false, default: 0
      t.jsonb :origins, null: false, default: []
      t.references :updated_by, foreign_key: { to_table: :users }
      t.timestamps null: false
    end

    add_check_constraint :video_shorts_origin_policies, "revision >= 0", name: "video_shorts_policy_revision_nonnegative"
    execute <<~SQL
      CREATE UNIQUE INDEX video_shorts_origin_policy_singleton
      ON video_shorts_origin_policies ((TRUE))
    SQL

    create_table :video_shorts_origin_policy_revisions do |t|
      t.references :origin_policy,
                   null: false,
                   foreign_key: { to_table: :video_shorts_origin_policies }
      t.integer :revision, null: false
      t.boolean :external_media_enabled, null: false
      t.jsonb :origins, null: false, default: []
      t.references :changed_by, foreign_key: { to_table: :users }
      t.datetime :created_at, null: false
    end

    add_index :video_shorts_origin_policy_revisions,
              %i[origin_policy_id revision],
              unique: true,
              name: "video_shorts_policy_revision_unique"
    add_check_constraint :video_shorts_origin_policy_revisions,
                         "revision > 0",
                         name: "video_shorts_policy_audit_revision_positive"

    execute <<~SQL
      INSERT INTO video_shorts_origin_policies
        (external_media_enabled, revision, origins, created_at, updated_at)
      VALUES
        (FALSE, 0, '[]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    SQL
  end

  def down
    drop_table :video_shorts_origin_policy_revisions
    drop_table :video_shorts_origin_policies
  end
end
