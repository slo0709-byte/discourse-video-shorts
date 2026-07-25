# frozen_string_literal: true

DiscourseVideoShorts::Engine.routes.draw do
  get "/video-shorts/comments/direct" => "comments#direct", constraints: { format: :json }
  get "/video-shorts/comments/count" => "comments#count", constraints: { format: :json }
  get "/video-shorts/comments/replies" => "comments#replies", constraints: { format: :json }
  get "/videos" => "videos#show"
end
