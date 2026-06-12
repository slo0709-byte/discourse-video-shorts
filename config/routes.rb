# frozen_string_literal: true

DiscourseVideoShorts::Engine.routes.draw do
  get "/videos" => "videos#show"
end
