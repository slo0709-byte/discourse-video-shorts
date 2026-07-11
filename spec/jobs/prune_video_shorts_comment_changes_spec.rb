# frozen_string_literal: true

RSpec.describe Jobs::PruneVideoShortsCommentChanges do
  let(:connection) { ActiveRecord::Base.connection }

  def insert_change(sequence:, changed_at:)
    connection.execute(
      <<~SQL,
        INSERT INTO video_shorts_comment_changes
          (source_post_id, changed_post_id, operation, sequence, changed_at)
        VALUES
          (1, #{connection.quote(sequence)}, 'edit', #{connection.quote(sequence)}, #{connection.quote(changed_at)})
      SQL
    )
  end

  it "removes expired change metadata while preserving the active delta window" do
    insert_change(sequence: 1, changed_at: 25.hours.ago)
    insert_change(sequence: 2, changed_at: 23.hours.ago)

    described_class.new.execute({})

    expect(
      connection.select_values(
        "SELECT sequence FROM video_shorts_comment_changes WHERE source_post_id = 1 ORDER BY sequence",
      ).map(&:to_i),
    ).to eq([2])
  end
end
