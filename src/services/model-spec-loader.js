/**
 * Model Spec Loader
 * ---------------------------------------------------------------------------
 * Single source of truth for every provider + model the gateway knows about.
 * Reads `config/models/*.yaml` at startup and exposes a queryable catalog.
 *
 * Drop-in replacement target for:
 *   - Hardcoded `this.models` maps in provider classes
 *   - Hardcoded `effortToBudget` / `forbid_params` / streaming-mode flags
 *   - The `in:` lists in `config/routing-rules.json` (for direct model routing)
 *
 * Usage:
 *   const ModelSpecLoader = require('./services/model-spec-loader');
 *   const specs = new ModelSpecLoader();
 *   await specs.load();                              // reads all YAML files
 *   const model = specs.getModel('claude-sonnet-4-6');
 *   const provider = specs.getProvider('anthropic');
 *   const budget = specs.effortToBudget('claude-opus-4-7', 'xhigh');
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ModelSpecLoader {
  /**
   * @param {string} [specsDir] - Directory containing the YAML specs.
   *                              Defaults to <gateway-root>/config/models.
   */
  constructor(specsDir) {
    this.specsDir = specsDir || path.join(__dirname, '..', '..', 'config', 'models');
    /** @type {Map<string, object>} providerId -> provider spec */
    this.providers = new Map();
    /** @type {Map<string, object>} modelId   -> { ...model, _providerId, _provider } */
    this.models = new Map();
    /** @type {object[]} validation issues encountered at load-time */
    this.issues = [];
  }

  async load() {
    if (!fs.existsSync(this.specsDir)) {
      throw new Error(`[ModelSpecLoader] specs dir not found: ${this.specsDir}`);
    }
    const files = fs
      .readdirSync(this.specsDir)
      .filter(f => /\.ya?ml$/i.test(f))
      .sort();

    for (const file of files) {
      const full = path.join(this.specsDir, file);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const doc = yaml.load(raw);
        this._ingest(doc, file);
      } catch (err) {
        this.issues.push({ file, error: err.message });
        console.error(`[ModelSpecLoader] Failed to load ${file}: ${err.message}`);
      }
    }

    console.log(
      `[ModelSpecLoader] Loaded ${this.providers.size} providers / ${this.models.size} models ` +
      `from ${files.length} YAML file(s) in ${this.specsDir}`
    );
    if (this.issues.length) {
      console.warn(`[ModelSpecLoader] ${this.issues.length} issue(s) during load:`, this.issues);
    }
    return this;
  }

  _ingest(doc, file) {
    if (!doc || !doc.provider || !doc.provider.id) {
      this.issues.push({ file, error: 'missing provider.id' });
      return;
    }
    const providerSpec = {
      ...doc.provider,
      quirks: doc.quirks || {},
      _sourceFile: file,
    };
    if (this.providers.has(providerSpec.id)) {
      this.issues.push({ file, error: `duplicate provider id: ${providerSpec.id}` });
      return;
    }
    this.providers.set(providerSpec.id, providerSpec);

    for (const m of doc.models || []) {
      if (!m.id) {
        this.issues.push({ file, error: 'model missing id' });
        continue;
      }
      if (this.models.has(m.id)) {
        this.issues.push({
          file,
          error: `duplicate model id: ${m.id} (also defined by ${this.models.get(m.id)._providerId})`,
        });
        continue;
      }
      this.models.set(m.id, {
        ...m,
        _providerId: providerSpec.id,
        _provider: providerSpec,
      });
    }
  }

  // --------------------------------------------------------------------- API

  getProvider(providerId) {
    return this.providers.get(providerId) || null;
  }

  getModel(modelId) {
    return this.models.get(modelId) || null;
  }

  /** All model IDs (optionally filtering out `hidden: true`). */
  listModelIds({ includeHidden = false } = {}) {
    const out = [];
    for (const [id, m] of this.models) {
      if (!includeHidden && m.hidden) continue;
      out.push(id);
    }
    return out;
  }

  /** All provider IDs. */
  listProviderIds() {
    return Array.from(this.providers.keys());
  }

  /** Which provider handles a given model ID? */
  providerForModel(modelId) {
    const m = this.models.get(modelId);
    return m ? m._provider : null;
  }

  /**
   * Resolve a PiCode-style reasoning_effort (low/medium/high/xhigh/max) into
   * an upstream budget token count for this model. Falls back to the
   * provider-level map, then returns null if neither defines it.
   */
  effortToBudget(modelId, effort) {
    const m = this.models.get(modelId);
    if (!m) return null;
    const eff = String(effort || '').toLowerCase();
    const modelMap = m.reasoning_effort_to_budget_tokens || m.reasoning_effort_to_thinking_budget;
    const provMap = m._provider.quirks?.reasoning_effort_to_budget_tokens
                 || m._provider.quirks?.reasoning_effort_to_thinking_budget;
    if (modelMap && modelMap[eff] != null) return modelMap[eff];
    if (provMap && provMap[eff] != null) return provMap[eff];
    return null;
  }

  /** Does this model support extended thinking? */
  supportsThinking(modelId) {
    const m = this.models.get(modelId);
    return !!(m && m.supports_extended_thinking);
  }

  /** Return merged quirks (provider + model-level overrides). */
  quirksFor(modelId) {
    const m = this.models.get(modelId);
    if (!m) return {};
    const p = m._provider.quirks || {};
    return { ...p, ...(m.quirks || {}) };
  }

  /**
   * Flat /v1/models-style output for clients (PiCode picker, OpenAI SDKs).
   * Hidden models are omitted by default.
   */
  toOpenAIListResponse({ includeHidden = false } = {}) {
    const data = [];
    for (const [id, m] of this.models) {
      if (!includeHidden && m.hidden) continue;
      data.push({
        id,
        object: 'model',
        owned_by: m._providerId,
        created: 0,
        // Extended metadata the standard OpenAI shape doesn't carry:
        display_name: m.display_name || id,
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        capabilities: m.capabilities || [],
        supports_extended_thinking: !!m.supports_extended_thinking,
        pricing: m.pricing || null,
      });
    }
    return { object: 'list', data };
  }
}

module.exports = ModelSpecLoader;
