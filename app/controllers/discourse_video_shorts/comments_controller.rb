# frozen_string_literal: true
class DiscourseVideoShorts::CommentsController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  def direct
    source = visible_post_from_params
    after = params[:after].nil? ? source.post_number : Integer(params[:after], exception: false)
    raise Discourse::NotFound if after.nil? || after.negative?

    render_json_dump(
      DiscourseVideoShorts::DirectComments.new(
        source: source,
        guardian: guardian,
        current_user: current_user,
        after: after,
      ).call,
    )
  end

  def count
    post = visible_post_from_params

    render_json_dump(count: DiscourseVideoShorts::CommentCount.new(post: post, guardian: guardian).call)
  end

  def replies
    post = visible_post_from_params

    after = params[:after].nil? ? post.post_number : Integer(params[:after], exception: false)
    raise Discourse::NotFound if after.nil? || after.negative?

    render_json_dump(
      DiscourseVideoShorts::CommentBranchReplies.new(
        parent: post,
        guardian: guardian,
        current_user: current_user,
        after: after,
      ).call,
    )
  end

  private

  def visible_post_from_params
    raise Discourse::NotFound unless SiteSetting.video_shorts_enabled

    post_id = Integer(params[:post_id], exception: false)
    raise Discourse::NotFound if post_id.blank? || !post_id.positive?

    post = Post.find_by(id: post_id, post_type: Post.types[:regular], deleted_at: nil)
    topic = post&.topic
    raise Discourse::NotFound if post.blank? || topic.blank? || topic.deleted_at.present?
    raise Discourse::NotFound if !guardian.can_see?(topic) || !guardian.can_see?(post)

    post
  end
end
