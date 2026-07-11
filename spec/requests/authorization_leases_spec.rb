# frozen_string_literal: true

RSpec.describe "Video shorts authorization leases" do
  fab!(:user)

  before { SiteSetting.video_shorts_enabled = true }

  def create_lease(source_post_ids)
    post "/videos/authorization-leases.json", params: { source_post_ids: source_post_ids }
  end

  it "issues five-second leases for one to three Guardian-visible source posts" do
    sign_in(user)
    sources = 3.times.map { Fabricate(:post, user: user) }

    freeze_time do
      (1..3).each do |count|
        create_lease(sources.take(count).map(&:id))

        expect(response.status).to eq(200)
        leases = response.parsed_body.fetch("leases")
        expect(leases.map { |lease| lease.fetch("source_post_id") }).to eq(sources.take(count).map(&:id))
        leases.each do |lease|
          expires_at = Time.iso8601(lease.fetch("expires_at"))
          token_payload =
            Rails.application.message_verifier("discourse-video-shorts-comments-v1").verify(lease.fetch("token"))

          expect(lease.fetch("expires_at")).to end_with("Z")
          expect(expires_at).to be_utc
          expect(expires_at).to be_within(0.000001).of(5.seconds.from_now)
          expect(token_payload).to include(
            "type" => "authorization_lease",
            "user_id" => user.id,
            "source_post_id" => lease.fetch("source_post_id"),
            "expires_at" => 5.seconds.from_now.to_i,
          )
        end
      end
    end
  end

  it "rejects more than three source post ids" do
    sign_in(user)
    sources = 4.times.map { Fabricate(:post, user: user) }

    create_lease(sources.map(&:id))

    expect(response.status).to eq(400)
    expect(response.parsed_body).to eq("error" => "invalid_source_post_ids")
  end

  it "fails closed for hidden and revoked sources" do
    sign_in(user)
    hidden_source = Fabricate(:post, user: user)
    hidden_source.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )

    create_lease([hidden_source.id])
    expect(response.status).to eq(404)
    private_source =
      Fabricate(
        :post,
        topic: Fabricate(:topic, category: Fabricate(:private_category, group: Fabricate(:group))),
      )

    create_lease([private_source.id])
    expect(response.status).to eq(404)

    revoked_source = Fabricate(:post, user: user)
    revoked_source.update_column(:deleted_at, Time.zone.now)

    create_lease([revoked_source.id])
    expect(response.status).to eq(404)
  end

  it "issues an anonymous lease only for an anonymously visible source" do
    source = Fabricate(:post, user: user)

    create_lease([source.id])

    expect(response.status).to eq(200)
    expect(response.parsed_body.dig("leases", 0, "source_post_id")).to eq(source.id)
  end

  it "fails closed when video shorts are disabled" do
    sign_in(user)
    source = Fabricate(:post, user: user)
    SiteSetting.video_shorts_enabled = false

    create_lease([source.id])

    expect(response.status).to eq(404)
  end

  it "does not issue leases outside the canary audience" do
    source = Fabricate(:post, user: user)
    canary_group = Fabricate(:group)
    SiteSetting.video_shorts_canary_group_ids = canary_group.id.to_s

    create_lease([source.id])
    expect(response.status).to eq(404)

    sign_in(user)
    create_lease([source.id])
    expect(response.status).to eq(403)
    expect(response.parsed_body).to eq("error" => "forbidden")
  end
end
