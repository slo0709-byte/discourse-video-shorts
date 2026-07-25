# frozen_string_literal: true

RSpec.describe "Discourse video shorts scaffold" do
  context "when video shorts are enabled" do
    before { SiteSetting.video_shorts_enabled = true }

    it "serves the public HTML route and JSON feed", :aggregate_failures do
      get "/videos"

      expect(response.status).to eq(200)
      expect(response.media_type).to eq("text/html")

      get "/videos.json"

      expect(response.status).to eq(200)
      expect(response.media_type).to eq("application/json")
      expect(response.parsed_body).to include(
        "items" => be_an(Array),
        "next_cursor" => be_nil,
        "scan_limit_reached" => be_in([true, false]),
      )
    end

    it "keeps /videos?format=json equivalent to /videos.json", :aggregate_failures do
      get "/videos.json"
      canonical_feed = response.parsed_body

      get "/videos?format=json"

      expect(response.status).to eq(200)
      expect(response.media_type).to eq("application/json")
      expect(response.parsed_body).to eq(canonical_feed)
    end
  end

  context "when video shorts are disabled" do
    before { SiteSetting.video_shorts_enabled = false }

    it "returns the disabled public route contract", :aggregate_failures do
      get "/videos"

      expect(response.status).to eq(200)
      expect(response.media_type).to eq("text/html")

      get "/videos.json"

      expect(response.status).to eq(404)
      expect(response.media_type).to eq("application/json")
      expect(response.parsed_body).to include("errors" => [I18n.t("not_found")])
      expect(response.parsed_body["error_type"]).to eq("not_found")
    end
  end
end
