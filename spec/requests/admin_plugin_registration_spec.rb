# frozen_string_literal: true

RSpec.describe Admin::PluginsController do
  fab!(:admin)

  describe "#show" do
    before { sign_in(admin) }

    it "exposes the explicit new admin plugin route", :aggregate_failures do
      get "/admin/plugins/discourse-video-shorts.json"

      expect(response.status).to eq(200)
      expect(response.parsed_body["id"]).to eq("discourse-video-shorts")
      expect(response.parsed_body["admin_route"]).to eq(
        "auto_generated" => false,
        "full_location" => "adminPlugins.show",
        "label" => "video_shorts.admin.title",
        "location" => "discourse-video-shorts",
        "use_new_show_route" => true,
      )
    end
  end
end
