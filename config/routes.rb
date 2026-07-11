# frozen_string_literal: true

DiscourseVideoShorts::Engine.routes.draw do
  get "/videos" => "videos#show"
  get "/videos/policy" => "policy_snapshot#show"
  get "/videos/posts/:post_id/comments" => "comments_snapshot#show"
  get "/videos/posts/:post_id/comments/delta" => "comments_delta#show"
  post "/videos/authorization-leases" => "authorization_leases#create"
end
