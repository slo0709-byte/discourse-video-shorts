#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"

module DiscourseVideoShorts
  class ObservabilityPrivacyVerifier
    class PrivacyError < StandardError; end

    FORBIDDEN_KEYS = /\A(?:authorization|cookie|set-cookie|proxy-authorization|body|正文|raw|cooked|excerpt|comment_text|password|passwd|secret|credential|access_token|refresh_token|api_key)\z/i
    FORBIDDEN_TEXT = [
      /https?:\/\//i,
      /(?:authorization|proxy-authorization|set-cookie|cookie)\s*[:=]/i,
      /\b(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/i,
      /\b(?:password|passwd|secret|credential|access_token|refresh_token|api[_-]?key)\s*[:=]/i,
      /\b(?:hmac|sha256_hmac)\s*[:=]\s*[a-f0-9]{32,}\b/i,
      /\A[a-f0-9]{64,}\z/i
    ].freeze
    HMAC_KEYS = /\A(?:hmac|sha256_hmac|media_identity_hmac)\z/i
    FULL_HMAC = /\A(?:[a-f0-9]{64}|[a-z0-9+\/]{43}=?)\z/i

    class << self
      def fail!(message)
        raise PrivacyError, message
      end

      def safe_relative_path?(value)
        value.is_a?(String) && value.match?(%r{\A[A-Za-z0-9][A-Za-z0-9._/-]*\z}) && !value.include?("..")
      end

      def inspect_value!(value, path, key = nil)
        fail!("forbidden sensitive field at #{path}") if key&.match?(FORBIDDEN_KEYS)
        fail!("full HMAC at #{path}") if key&.match?(HMAC_KEYS) && value.is_a?(String) && value.match?(FULL_HMAC)
        case value
        when Hash
          value.each { |child_key, child| inspect_value!(child, "#{path}.#{child_key}", child_key.to_s) }
        when Array
          value.each_with_index { |child, index| inspect_value!(child, "#{path}[#{index}]") }
        when String
          FORBIDDEN_TEXT.each { |pattern| fail!("sensitive value at #{path}") if value.match?(pattern) }
        end
      end

      def run
        
          evidence_dir = ARGV.fetch(0) { fail!("usage: #{$PROGRAM_NAME} EVIDENCE_DIR") }
          fail!("unexpected arguments") unless ARGV.length == 1
          root = Pathname.new(evidence_dir).expand_path
          fail!("evidence directory does not exist") unless root.directory?

          manifests = root.glob("**/*.json")
          fail!("no JSON evidence was found") if manifests.empty?
          manifests.each do |file|
            relative = file.relative_path_from(root).to_s
            fail!("unsafe evidence path") unless safe_relative_path?(relative)
            document = JSON.parse(file.read)
            inspect_value!(document, relative)
          rescue JSON::ParserError => e
            fail!("invalid JSON in #{relative}: #{e.message}")
          end

          puts "Evidence contains no bodies, credentials, headers, cookies, full external URLs, or full HMACs."
        rescue PrivacyError => e
          warn "Privacy validation failed: #{e.message}"
          exit 1
        
      end
    end
  end
end

DiscourseVideoShorts::ObservabilityPrivacyVerifier.run
