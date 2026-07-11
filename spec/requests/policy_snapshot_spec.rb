# frozen_string_literal: true

RSpec.describe "Discourse video shorts policy snapshot" do
  fab!(:admin)
  fab!(:user)

  before do
    SiteSetting.video_shorts_enabled = true
  end

  def update_policy(origins:, enabled: true)
    DiscourseVideoShorts::OriginPolicy.current.update!(
      origins: origins,
      external_media_enabled: enabled,
      actor: admin,
    )
  end

  it "returns an immutable revision-bound snapshot for the current user" do
    update_policy(origins: ["https://MEDIA.example:443", "https://cdn.example"])
    sign_in(user)

    get "/videos/policy.json"

    expect(response.status).to eq(200)
    expect(response.headers["ETag"]).to eq('"policy-1"')
    expect(response.headers["Cache-Control"]).to eq("no-cache, private, must-revalidate")
    expect(response.parsed_body).to include(
      "revision" => 1,
      "external_media_enabled" => true,
      "origins" => %w[https://cdn.example https://media.example],
    )
    expect { Time.iso8601(response.parsed_body.fetch("generated_at")) }.not_to raise_error
  end

  it "returns 304 when the client has the current policy ETag" do
    update_policy(origins: ["https://media.example"])
    sign_in(user)

    get "/videos/policy.json", headers: { "If-None-Match" => '"policy-1"' }

    expect(response.status).to eq(304)
    expect(response.body).to be_empty
    expect(response.headers["ETag"]).to eq('"policy-1"')
    expect(response.headers["Cache-Control"]).to eq("no-cache, private, must-revalidate")
  end

  it "returns a disabled policy without authorizing external media" do
    update_policy(origins: ["https://media.example"], enabled: false)
    sign_in(user)

    get "/videos/policy.json"

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "revision" => 1,
      "external_media_enabled" => false,
      "origins" => ["https://media.example"],
    )
  end

  it "does not expose policy data outside the canary audience" do
    canary_group = Fabricate(:group)
    SiteSetting.video_shorts_canary_group_ids = canary_group.id.to_s

    get "/videos/policy.json"
    expect(response.status).to eq(404)
    expect(response.body).not_to include("origins")

    sign_in(user)
    get "/videos/policy.json"
    expect(response.status).to eq(403)
    expect(response.parsed_body).to eq("error" => "forbidden")
  end

  it "normalizes HTTPS origins and rejects non-origin URLs" do
    normalized = DiscourseVideoShorts::OriginPolicy.normalize_origin("HTTPS://MEDIA.example:443")

    expect(normalized).to eq("https://media.example")
    expect(DiscourseVideoShorts::OriginPolicy.normalize_origin(normalized)).to eq(normalized)

    [
      " https://media.example",
      "https://media.example/",
      "https://media.example/path",
      "https://media.example?query=value",
      "https://user@media.example",
      "http://media.example",
      "https://*.example",
    ].each do |origin|
      expect {
        DiscourseVideoShorts::OriginPolicy.normalize_origin(origin)
      }.to raise_error(ArgumentError, "origin must be a normalized HTTPS origin")
    end
  end
  it "rejects non-HTTPS origins without changing the current policy" do
    policy = DiscourseVideoShorts::OriginPolicy.current

    expect {
      policy.update!(origins: ["http://media.example"], external_media_enabled: true, actor: admin)
    }.to raise_error(ArgumentError, "origin must be a normalized HTTPS origin")

    sign_in(user)
    get "/videos/policy.json"

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "revision" => 0,
      "external_media_enabled" => false,
      "origins" => [],
    )
  end
end
