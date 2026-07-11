import { on } from "@ember/modifier";
import { userPath } from "discourse/lib/url";
import DButton from "discourse/ui-kit/d-button";
import DConditionalLoadingSpinner from "discourse/ui-kit/d-conditional-loading-spinner";
import DPageSubheader from "discourse/ui-kit/d-page-subheader";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

export default <template>
  <div class="admin-detail video-shorts-admin-diagnostics">
    <DPageSubheader @titleLabel={{i18n "video_shorts.admin.diagnostics.title"}}>
      <:actions as |actions|>
        <actions.Wrapped>
          <DButton
            @action={{@controller.refresh}}
            @icon="arrows-rotate"
            @label="video_shorts.admin.diagnostics.refresh"
            @disabled={{@controller.loading}}
            class="btn-default"
          />
        </actions.Wrapped>
        <actions.Wrapped>
          <a class="btn btn-default" href="/videos">
            {{dIcon "up-right-from-square"}}
            {{i18n "video_shorts.admin.diagnostics.open_videos"}}
          </a>
        </actions.Wrapped>
      </:actions>
    </DPageSubheader>

    <DConditionalLoadingSpinner @condition={{@controller.loading}} />
    <section class="video-shorts-admin-diagnostics__section">
      <h3>{{i18n "video_shorts.admin.diagnostics.policy.title"}}</h3>
      <p>{{i18n "video_shorts.admin.diagnostics.policy.description"}}</p>

      {{#if @controller.policyLoadError}}
        <p class="video-shorts-admin-diagnostics__error" role="alert">
          {{dIcon "triangle-exclamation"}}
          {{i18n "video_shorts.admin.diagnostics.policy.load_error"}}
        </p>
      {{else}}
        <dl class="video-shorts-admin-diagnostics__summary">
          <dt>{{i18n "video_shorts.admin.diagnostics.policy.revision"}}</dt>
          <dd>{{@controller.policyRevision}}</dd>
          <dt>{{i18n "video_shorts.admin.diagnostics.policy.health"}}</dt>
          <dd>{{i18n @controller.policyHealthLabel}}</dd>
        </dl>

        <label>
          <input
            type="checkbox"
            checked={{@controller.externalMediaEnabled}}
            disabled={{@controller.savingPolicy}}
            {{on "change" @controller.updateExternalMediaEnabled}}
          />
          {{i18n "video_shorts.admin.diagnostics.policy.external_media_enabled"}}
        </label>

        <label for="video-shorts-policy-origins">
          {{i18n "video_shorts.admin.diagnostics.policy.origins"}}
        </label>
        <textarea
          id="video-shorts-policy-origins"
          value={{@controller.originLines}}
          disabled={{@controller.savingPolicy}}
          placeholder={{i18n "video_shorts.admin.diagnostics.policy.origins_placeholder"}}
          {{on "input" @controller.updateOrigins}}
        ></textarea>
        <p>{{i18n "video_shorts.admin.diagnostics.policy.origins_help"}}</p>

        {{#if @controller.policyErrors.length}}
          <ul class="video-shorts-admin-diagnostics__warnings" role="alert">
            {{#each @controller.policyErrors as |error|}}
              <li>{{dIcon "triangle-exclamation"}} {{error}}</li>
            {{/each}}
          </ul>
        {{/if}}

        {{#if @controller.policySaved}}
          <p role="status">
            {{dIcon "check"}}
            {{i18n "video_shorts.admin.diagnostics.policy.saved"}}
          </p>
        {{/if}}

        <DButton
          @action={{@controller.savePolicy}}
          @icon="floppy-disk"
          @label="video_shorts.admin.diagnostics.policy.save"
          @disabled={{@controller.savingPolicy}}
          class="btn-primary"
        />
      {{/if}}
    </section>

    {{#if @controller.hasError}}
      <div class="video-shorts-admin-diagnostics__error">
        {{dIcon "triangle-exclamation"}}
        <span>{{i18n "video_shorts.admin.diagnostics.load_error"}}</span>
      </div>
    {{else if @controller.hasDiagnostics}}
      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.status"}}</h3>
        <dl class="video-shorts-admin-diagnostics__summary">
          <dt>{{i18n "video_shorts.admin.diagnostics.enabled"}}</dt>
          <dd>
            {{#if @controller.model.enabled}}
              {{i18n "video_shorts.admin.diagnostics.enabled_yes"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.enabled_no"}}
            {{/if}}
          </dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.sample_size"}}</dt>
          <dd>{{@controller.model.feed.sample_size}}</dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.scan_limit"}}</dt>
          <dd>{{@controller.model.feed.scan_limit}}</dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.scan_limit_reached"}}</dt>
          <dd>
            {{#if @controller.model.feed.scan_limit_reached}}
              {{i18n "video_shorts.admin.diagnostics.enabled_yes"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.enabled_no"}}
            {{/if}}
          </dd>
        </dl>
      </section>
      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.health.title"}}</h3>
        <dl class="video-shorts-admin-diagnostics__summary">
          <dt>{{i18n "video_shorts.admin.diagnostics.health.kill_switch"}}</dt>
          <dd>
            {{#if @controller.model.kill_switch.active}}
              {{i18n "video_shorts.admin.diagnostics.health.kill_switch_active"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.health.kill_switch_ready"}}
            {{/if}}
          </dd>
          <dt>{{i18n "video_shorts.admin.diagnostics.health.canary"}}</dt>
          <dd>
            {{#if @controller.model.canary.enabled}}
              {{i18n "video_shorts.admin.diagnostics.health.canary_limited"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.health.canary_all_members"}}
            {{/if}}
          </dd>
          <dt>{{i18n "video_shorts.admin.diagnostics.health.policy"}}</dt>
          <dd>
            {{#if @controller.model.policy.external_media_enabled}}
              {{i18n "video_shorts.admin.diagnostics.policy.health_enabled"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.policy.health_disabled"}}
            {{/if}}
          </dd>
          <dt>{{i18n "video_shorts.admin.diagnostics.health.comments"}}</dt>
          <dd>
            {{#if @controller.model.runtime.delta.observable}}
              {{i18n "video_shorts.admin.diagnostics.health.observable"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.health.not_observable"}}
            {{/if}}
          </dd>
          <dt>{{i18n "video_shorts.admin.diagnostics.health.revocation"}}</dt>
          <dd>
            {{#if @controller.model.runtime.authorization_lease.observable}}
              {{i18n "video_shorts.admin.diagnostics.health.observable"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.health.not_observable"}}
            {{/if}}
          </dd>
        </dl>
      </section>

      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.sources"}}</h3>
        <dl class="video-shorts-admin-diagnostics__summary">
          <dt>{{i18n "video_shorts.admin.diagnostics.configured_categories"}}</dt>
          <dd>
            {{@controller.model.sources.configured.category_ids.length}}
            {{#if @controller.model.sources.configured.categories.length}}
              <ul class="video-shorts-admin-diagnostics__source-list">
                {{#each @controller.model.sources.configured.categories as |category|}}
                  <li>{{category.name}} (#{{category.id}})</li>
                {{/each}}
              </ul>
            {{/if}}
          </dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.effective_categories"}}</dt>
          <dd>
            {{@controller.model.sources.effective.category_ids.length}}
            {{#if @controller.model.sources.effective.categories.length}}
              <ul class="video-shorts-admin-diagnostics__source-list">
                {{#each @controller.model.sources.effective.categories as |category|}}
                  <li>{{category.name}} (#{{category.id}})</li>
                {{/each}}
              </ul>
            {{/if}}
          </dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.configured_tags"}}</dt>
          <dd>
            {{@controller.model.sources.configured.tag_names.length}}
            {{#if @controller.model.sources.configured.tags.length}}
              <ul class="video-shorts-admin-diagnostics__source-list">
                {{#each @controller.model.sources.configured.tags as |tag|}}
                  <li>{{tag.name}}</li>
                {{/each}}
              </ul>
            {{/if}}
          </dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.effective_tags"}}</dt>
          <dd>
            {{@controller.model.sources.effective.tag_names.length}}
            {{#if @controller.model.sources.effective.tags.length}}
              <ul class="video-shorts-admin-diagnostics__source-list">
                {{#each @controller.model.sources.effective.tags as |tag|}}
                  <li>{{tag.name}}</li>
                {{/each}}
              </ul>
            {{/if}}
          </dd>
        </dl>

        {{#if @controller.sourceWarnings.length}}
          <ul class="video-shorts-admin-diagnostics__warnings">
            {{#each @controller.sourceWarnings as |warning|}}
              <li>
                {{dIcon "triangle-exclamation"}}
                <span data-warning-code={{warning.code}}>{{warning.label}}</span>
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p>{{i18n "video_shorts.admin.diagnostics.no_warnings"}}</p>
        {{/if}}
      </section>

      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.providers"}}</h3>
        <div class="video-shorts-admin-diagnostics__table-wrapper">
          <table class="d-table">
            <thead>
              <tr>
                <th>{{i18n "video_shorts.admin.diagnostics.name"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.count"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @controller.model.media.kinds as |kind|}}
                <tr>
                  <td>{{@controller.mediaKindLabel kind.name}}</td>
                  <td>{{kind.count}}</td>
                </tr>
              {{else}}
                <tr>
                  <td colspan="2">{{i18n "video_shorts.admin.diagnostics.no_provider_counts"}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
      </section>
      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.media_failures"}}</h3>
        <div class="video-shorts-admin-diagnostics__table-wrapper">
          <table class="d-table">
            <thead>
              <tr>
                <th>{{i18n "video_shorts.admin.diagnostics.failure"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.count"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @controller.model.media.failed_reasons as |failure|}}
                <tr>
                  <td>{{@controller.failureReasonLabel failure.reason}}</td>
                  <td>{{failure.count}}</td>
                </tr>
              {{else}}
                <tr>
                  <td colspan="2">{{i18n "video_shorts.admin.diagnostics.no_media_failures"}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
      </section>


      <section class="video-shorts-admin-diagnostics__section">
        <h3>{{i18n "video_shorts.admin.diagnostics.samples"}}</h3>
        <div class="video-shorts-admin-diagnostics__table-wrapper">
          <table class="d-table">
            <thead>
              <tr>
                <th>{{i18n "video_shorts.admin.diagnostics.topic"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.post"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.user"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.category"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.tags"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.name"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.failure"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @controller.model.samples as |sample|}}
                <tr>
                  <td>
                    {{#let (@controller.safeTopicPath sample) as |topicPath|}}
                      {{#if topicPath}}
                        <a href={{topicPath}}>{{sample.title}}</a>
                      {{else}}
                        {{sample.title}}
                      {{/if}}
                    {{/let}}
                  </td>
                  <td>
                    {{#let (@controller.safeTopicPath sample) as |topicPath|}}
                      {{#if topicPath}}
                        <a href={{topicPath}}>
                          {{i18n "video_shorts.admin.diagnostics.open_topic"}}
                        </a>
                      {{else}}
                        {{i18n "video_shorts.admin.diagnostics.unavailable"}}
                      {{/if}}
                    {{/let}}
                  </td>
                  <td>
                    {{#if sample.username}}
                      <a
                        href={{userPath sample.username}}
                        data-user-card={{sample.username}}
                      >
                        {{sample.username}}
                      </a>
                    {{else}}
                      {{i18n "video_shorts.admin.diagnostics.unknown_user"}}
                    {{/if}}
                  </td>
                  <td>
                    {{#if sample.category}}
                      {{sample.category.name}}
                    {{else}}
                      {{i18n "video_shorts.admin.diagnostics.unavailable"}}
                    {{/if}}
                  </td>
                  <td>
                    {{#if sample.tags.length}}
                      <ul class="video-shorts-admin-diagnostics__source-list">
                        {{#each sample.tags as |tag|}}
                          <li>{{tag.name}}</li>
                        {{/each}}
                      </ul>
                    {{else}}
                      {{i18n "video_shorts.admin.diagnostics.unavailable"}}
                    {{/if}}
                  </td>
                  <td>{{@controller.mediaKindLabel sample.media.kind}}</td>
                  <td>
                    {{#if sample.media.fallback_reason}}
                      {{@controller.failureReasonLabel sample.media.fallback_reason}}
                    {{else}}
                      {{i18n "video_shorts.admin.diagnostics.unavailable"}}
                    {{/if}}
                  </td>
                </tr>
              {{else}}
                <tr>
                  <td colspan="7">{{i18n "video_shorts.admin.diagnostics.no_samples"}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
      </section>
    {{else}}
      <p class="video-shorts-admin-diagnostics__empty">
        {{i18n "video_shorts.admin.diagnostics.empty"}}
      </p>
    {{/if}}
  </div>
</template>
