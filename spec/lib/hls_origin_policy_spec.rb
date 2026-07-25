# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::HlsOriginPolicy do
  describe ".normalize_origin" do
    it "normalizes HTTPS scheme, host, default port, and path to an origin" do
      expect(described_class.normalize_origin(" HTTPS://MEDIA.Example.COM:443/live/index.m3u8?x=1#y ")).to eq(
        "https://media.example.com",
      )
      expect(described_class.normalize_origin("https://media.example.com:8443/live")).to eq(
        "https://media.example.com:8443",
      )
    end

    it "rejects HTTP, credentials, wildcards, and malformed origins" do
      invalid_values = [
        "http://media.example.com",
        "https://user:secret@media.example.com",
        "https://*.example.com",
        "javascript:alert(1)",
        "https://bad host.example.com",
        "not a URL",
      ]

      invalid_values.each { |value| expect(described_class.normalize_origin(value)).to be_nil }
    end
  end
end
