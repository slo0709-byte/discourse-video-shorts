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
        <h3>{{i18n "video_shorts.admin.diagnostics.delivery"}}</h3>
        <dl class="video-shorts-admin-diagnostics__summary">
          <dt>{{i18n "video_shorts.admin.diagnostics.hls_requires_https"}}</dt>
          <dd>
            {{#if @controller.model.delivery.hls.requires_https}}
              {{i18n "video_shorts.admin.diagnostics.enabled_yes"}}
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.enabled_no"}}
            {{/if}}
          </dd>

          <dt>{{i18n "video_shorts.admin.diagnostics.hls_allowed_origins"}}</dt>
          <dd>
            {{#if @controller.model.delivery.hls.allowed_origins.length}}
              <ul class="video-shorts-admin-diagnostics__source-list">
                {{#each @controller.model.delivery.hls.allowed_origins as |origin|}}
                  <li>{{origin}}</li>
                {{/each}}
              </ul>
            {{else}}
              {{i18n "video_shorts.admin.diagnostics.none_configured"}}
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
              {{#each @controller.model.providers.counts as |provider|}}
                <tr>
                  <td>{{provider.name}}</td>
                  <td>{{provider.count}}</td>
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
        <h3>{{i18n "video_shorts.admin.diagnostics.renderability_counts"}}</h3>
        <div class="video-shorts-admin-diagnostics__table-wrapper">
          <table class="d-table">
            <thead>
              <tr>
                <th>{{i18n "video_shorts.admin.diagnostics.name"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.count"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @controller.model.renderability.counts as |renderability|}}
                <tr>
                  <td>{{renderability.name}}</td>
                  <td>{{renderability.count}}</td>
                </tr>
              {{else}}
                <tr>
                  <td colspan="2">{{i18n "video_shorts.admin.diagnostics.no_renderability_counts"}}</td>
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
                <th>{{i18n "video_shorts.admin.diagnostics.provider"}}</th>
                <th>{{i18n "video_shorts.admin.diagnostics.renderability"}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @controller.model.samples as |sample|}}
                <tr>
                  <td>
                    {{#if sample.topic_url}}
                      <a href={{sample.topic_url}}>{{sample.title}}</a>
                    {{else}}
                      {{sample.title}}
                    {{/if}}
                  </td>
                  <td>
                    {{#if sample.post_url}}
                      <a href={{sample.post_url}}>
                        {{i18n "video_shorts.admin.diagnostics.open_post"}}
                      </a>
                    {{else}}
                      {{i18n "video_shorts.admin.diagnostics.unavailable"}}
                    {{/if}}
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
                  <td>{{sample.media.provider}}</td>
                  <td>{{sample.media.renderability}}</td>
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
