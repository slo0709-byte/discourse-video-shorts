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
      expect(response.parsed_body).to match(
        "schema_version" => 1,
        "feed_revision" => a_string_matching(/\A[a-f0-9]{64}\z/),
        "items" => [],
        "next_cursor" => nil,
        "scan" => {
          "candidates_scanned" => 0,
          "scan_limit_reached" => false,
          "end_reached" => true,
        },
      )
    end

    it "keeps /videos?format=json equivalent to /videos.json", :aggregate_failures do
      get "/videos?format=json"

      expect(response.status).to eq(200)
      expect(response.media_type).to eq("application/json")
      expect(response.parsed_body).to match(
        "schema_version" => 1,
        "feed_revision" => a_string_matching(/\A[a-f0-9]{64}\z/),
        "items" => [],
        "next_cursor" => nil,
        "scan" => {
          "candidates_scanned" => 0,
          "scan_limit_reached" => false,
          "end_reached" => true,
        },
      )
    end
  end

  context "when video shorts are disabled" do
    before { SiteSetting.video_shorts_enabled = false }

    it "returns the disabled public route contract", :aggregate_failures do
      get "/videos"

      expect(response.status).to eq(404)
      expect(response.media_type).to eq("text/html")

      get "/videos.json"

      expect(response.status).to eq(404)
      expect(response.media_type).to eq("application/json")
      expect(response.parsed_body).to eq("error" => "not_found")
    end
  end
end
