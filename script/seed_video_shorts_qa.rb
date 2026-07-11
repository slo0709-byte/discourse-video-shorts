# frozen_string_literal: true

require "json"
require "securerandom"

password = ENV.fetch("VIDEO_SHORTS_QA_SEED_PASSWORD") { SecureRandom.base58(24) }
admin =
  User.find_by(username: "video_admin") ||
    User.create!(
      username: "video_admin",
      email: "video-admin@example.test",
      name: "Video Admin",
      password: password,
      active: true,
      admin: true,
    )
admin.update!(admin: true, active: true)
admin.activate

member =
  User.find_by(username: "video_member") ||
    User.create!(
      username: "video_member",
      email: "video-member@example.test",
      name: "Video Member",
      password: password,
      active: true,
    )
member.update!(active: true)
member.activate

SiteSetting.authorized_extensions =
  (SiteSetting.authorized_extensions.split("|") + %w[mp4]).uniq.join("|")
SiteSetting.video_shorts_enabled = true

category =
  Category.find_by(name: "Video Shorts QA") || Category.create!(name: "Video Shorts QA", user: admin)
SiteSetting.video_shorts_source_category_ids = category.id.to_s
group = Group.find_by(name: "video_shorts_private") || Group.create!(name: "video_shorts_private")
group.add(member)
private_category =
  Category.find_by(name: "Video Shorts Private QA") ||
    Category.create!(name: "Video Shorts Private QA", read_restricted: true, user: admin)
private_category.set_permissions(group => :full)
private_category.save!

module DiscourseVideoShorts
  def self.create_qa_topic_once(user:, title:, raw:, category:)
    existing = Topic.find_by(title: title)
    return existing if existing

    post =
      PostCreator.create!(
        user,
        title: title,
        raw: raw,
        category: category.id,
        skip_validations: true,
      )
    post.topic
  end
end

fixture_path = Rails.root.join("plugins/discourse-video-shorts/spec/fixtures/files/tiny-video.mp4")
upload =
  Upload.find_by(original_filename: "tiny-video.mp4") ||
    UploadCreator.new(File.open(fixture_path), "tiny-video.mp4", skip_validations: true).create_for(
      admin.id,
    )

topics = {}
topics[:native] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Native MP4",
    raw: "Native MP4 fixture\n\n#{upload.short_url}",
    category: category,
  )
UploadReference.find_or_create_by!(
  upload_id: upload.id,
  target_type: "Post",
  target_id: topics[:native].first_post.id,
)
topics[:bilibili_canonical] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Bilibili Canonical",
    raw: "https://www.bilibili.com/video/BV1Q541167Qg",
    category: category,
  )
topics[:bilibili_iframe] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Bilibili Cooked Iframe",
    raw:
      '<iframe src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1"></iframe>',
    category: category,
  )
topics[:youtube_iframe] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA YouTube Cooked Iframe",
    raw: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    category: category,
  )
topics[:vimeo_iframe] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Vimeo Cooked Iframe",
    raw: '<iframe src="https://player.vimeo.com/video/786646692"></iframe>',
    category: category,
  )
topics[:unsupported] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Unsupported Intended Video",
    raw: "https://example.invalid/videos/unsupported-sample.mp4?token=private#fragment",
    category: category,
  )
topics[:non_video] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: admin,
    title: "Video Shorts QA Non Video",
    raw: "Plain discussion with no video media.",
    category: category,
  )
topics[:private_native] =
  DiscourseVideoShorts.create_qa_topic_once(
    user: member,
    title: "Video Shorts QA Private Native MP4",
    raw: "Private native MP4 fixture\n\n#{upload.short_url}",
    category: private_category,
  )

puts(
  JSON.pretty_generate(
    category_id: category.id,
    private_category_id: private_category.id,
    admin_id: admin.id,
    member_id: member.id,
    upload_id: upload.id,
    topic_ids: topics.transform_values(&:id),
  ),
)
