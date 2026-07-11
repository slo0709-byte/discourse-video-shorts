# frozen_string_literal: true

class DiscourseVideoShorts::Admin::OriginsController < Admin::AdminController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  def show
    render_json_dump(serialize_snapshot(DiscourseVideoShorts::Policy::Snapshot.current))
  end

  def update
    policy =
      DiscourseVideoShorts::OriginPolicy.current.update!(
        origins: origins_param,
        external_media_enabled: external_media_enabled_param,
        actor: current_user,
      )

    render_json_dump(serialize_policy(policy))
  rescue ArgumentError => error
    render_json_dump({ errors: [error.message] }, status: 422)
  end

  private

  def origins_param
    params.require(:origins)
  end

  def external_media_enabled_param
    case params.require(:external_media_enabled)
    when true, "true", "1"
      true
    when false, "false", "0"
      false
    else
      raise ArgumentError, "external_media_enabled must be true or false"
    end
  end

  def serialize_snapshot(snapshot)
    {
      revision: snapshot.revision,
      external_media_enabled: snapshot.external_media_enabled,
      origins: snapshot.origins,
      generated_at: snapshot.generated_at,
    }
  end

  def serialize_policy(policy)
    {
      revision: policy.revision,
      external_media_enabled: policy.external_media_enabled,
      origins: policy.origins,
      updated_at: policy.updated_at.iso8601,
      updated_by_id: policy.updated_by_id,
    }
  end
end
