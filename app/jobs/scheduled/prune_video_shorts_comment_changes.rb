# frozen_string_literal: true

module Jobs
  class PruneVideoShortsCommentChanges < ::Jobs::Scheduled
    every 1.hour

    def execute(_args)
      DiscourseVideoShorts::Comments::ChangeRecorder.prune!
    end
  end
end
