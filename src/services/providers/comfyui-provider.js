const axios = require('axios');
const { EventEmitter } = require('events');
const { Pool } = require('pg');
const WebSocket = require('ws');

/**
 * ComfyUI Provider for AI Gateway v2.0
 * Supports HiDream-I1, FLUX, Stable Diffusion XL and other image generation models
 * Features: Safety filtering, parental controls, prompt blocking, NSFW detection
 */
class ComfyUIProvider extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || 'comfyui';
    this.name = config.name || 'ComfyUI';
    this.type = 'local';
    this.endpoint = config.endpoint || process.env.COMFYUI_URL || 'http://localhost:8188';
    this.wsEndpoint = this.endpoint.replace('http', 'ws') + '/ws';
    this.safetyEndpoint = config.safetyEndpoint || process.env.COMFYUI_SAFETY_URL || 'http://localhost:8189';
    
    // WebSocket connection for progress streaming
    this.ws = null;
    this.wsClientId = null;
    this.progressCallbacks = new Map(); // promptId -> callback function
    
    // Database connection for model registry
    this.db = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: 'ai_inferencing_db',
      user: process.env.POSTGRES_USER || 'eleazar',
      password: process.env.POSTGRES_PASSWORD || '',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
    
    // Models loaded from database during initialization
    this.models = config.models || [];
    this.capabilities = ['image_generation', 'image_editing', 'inpainting', 'upscaling'];
    this.status = 'inactive';
    this.lastHealthCheck = null;
    this.requestCount = 0;
    this.errorCount = 0;
    
    // Safety filtering removed - handled by AI Gateway Llama Guard
    
    // ComfyUI-specific features
    this.features = {
      batchGeneration: true,
      workflowSupport: true
    };
    
    // Pricing (local = free, but track for analytics)
    this.pricing = {
      'hidream-i1-full': { perImage: 0, gpuMinutes: 0.5 },
      'hidream-i1-dev': { perImage: 0, gpuMinutes: 0.3 },
      'flux-dev': { perImage: 0, gpuMinutes: 0.4 },
      'flux-schnell': { perImage: 0, gpuMinutes: 0.2 },
      'sdxl': { perImage: 0, gpuMinutes: 0.3 }
    };
    
    this.httpClient = axios.create({
      baseURL: this.endpoint,
      timeout: 300000, // 5 minutes for image generation
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Gateway-v2.0'
      }
    });
    
    this.safetyClient = axios.create({
      baseURL: this.safetyEndpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Initialize the ComfyUI provider
   */
  async initialize() {
    try {
      console.log(`[ComfyUI Provider] Initializing ${this.name}...`);
      
      // Load models from database
      await this.loadModelsFromDatabase();
      console.log(`[ComfyUI Provider] Loaded ${this.models.length} models from database`);
      
      // Validate ComfyUI connection
      await this.validateConnection();
      
      // Initialize WebSocket for progress streaming
      await this.initWebSocket();
      
      this.status = 'active';
      
      console.log(`[ComfyUI Provider] ${this.name} initialized successfully`);
      this.emit('initialized', { provider: this.id, status: this.status });
      
      return true;
    } catch (error) {
      console.error(`[ComfyUI Provider] Initialization failed:`, error.message);
      this.status = 'error';
      this.emit('error', { provider: this.id, error: error.message });
      // Don't throw - allow gateway to start without ComfyUI
      return false;
    }
  }

  /**
   * Load available models from database
   */
  async loadModelsFromDatabase() {
    try {
      const result = await this.db.query(`
        SELECT 
          model_id,
          model_name,
          capabilities,
          metadata
        FROM provider_models
        WHERE provider_id = $1 AND is_active = true
        ORDER BY model_id
      `, ['comfyui']);
      
      if (result.rows.length === 0) {
        console.warn(`[ComfyUI Provider] No models found in database, using defaults`);
        this.models = ['hidream-i1-full', 'flux-dev', 'flux-schnell', 'sdxl'];
        return;
      }
      
      this.models = result.rows.map(row => row.model_id);
      console.log(`[ComfyUI Provider] Database models: ${this.models.join(', ')}`);
      
    } catch (error) {
      console.warn(`[ComfyUI Provider] Database query failed, using defaults:`, error.message);
      this.models = ['hidream-i1-full', 'flux-dev', 'flux-schnell', 'sdxl'];
    }
  }

  /**
   * Validate connection to ComfyUI
   */
  async validateConnection() {
    try {
      const response = await this.httpClient.get('/system_stats');
      this.lastHealthCheck = new Date();
      console.log(`[ComfyUI Provider] Connection validated - ComfyUI is running`);
      return true;
    } catch (error) {
      console.warn(`[ComfyUI Provider] ComfyUI not reachable at ${this.endpoint}`);
      return false;
    }
  }

  /**
   * Initialize WebSocket connection for progress streaming
   */
  async initWebSocket() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wsEndpoint);
        
        this.ws.on('open', () => {
          console.log(`[ComfyUI Provider] WebSocket connected for progress streaming`);
          resolve(true);
        });
        
        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            this.handleWebSocketMessage(msg);
          } catch (e) {
            // Binary data (preview image)
            this.handlePreviewImage(data);
          }
        });
        
        this.ws.on('close', () => {
          console.log(`[ComfyUI Provider] WebSocket closed, reconnecting in 5s...`);
          setTimeout(() => this.initWebSocket(), 5000);
        });
        
        this.ws.on('error', (err) => {
          console.warn(`[ComfyUI Provider] WebSocket error:`, err.message);
          resolve(false);
        });
        
        // Timeout if connection takes too long
        setTimeout(() => resolve(false), 5000);
      } catch (error) {
        console.warn(`[ComfyUI Provider] WebSocket init failed:`, error.message);
        resolve(false);
      }
    });
  }

  /**
   * Handle WebSocket messages from ComfyUI
   */
  handleWebSocketMessage(msg) {
    const { type, data } = msg;
    
    switch (type) {
      case 'status':
        if (data.sid) {
          this.wsClientId = data.sid;
        }
        break;
        
      case 'execution_start':
        this.emitProgress(data.prompt_id, {
          type: 'start',
          promptId: data.prompt_id
        });
        break;
        
      case 'execution_cached':
        // Node was cached, skip
        break;
        
      case 'executing':
        if (data.node) {
          this.emitProgress(data.prompt_id, {
            type: 'executing',
            promptId: data.prompt_id,
            node: data.node
          });
        } else {
          // Execution complete
          this.emitProgress(data.prompt_id, {
            type: 'complete',
            promptId: data.prompt_id
          });
        }
        break;
        
      case 'progress':
        this.emitProgress(data.prompt_id, {
          type: 'progress',
          promptId: data.prompt_id,
          step: data.value,
          maxSteps: data.max,
          percent: Math.round((data.value / data.max) * 100)
        });
        break;
        
      case 'executed':
        this.emitProgress(data.prompt_id, {
          type: 'executed',
          promptId: data.prompt_id,
          node: data.node,
          output: data.output
        });
        break;
    }
  }

  /**
   * Handle binary preview image data
   */
  handlePreviewImage(data) {
    // Preview images come as binary with a header
    // Format: type (4 bytes) + format (4 bytes) + image data
    if (data.length > 8) {
      const imageData = data.slice(8);
      const base64 = imageData.toString('base64');
      
      // Emit to all active callbacks (we don't know which prompt this is for)
      for (const [promptId, callback] of this.progressCallbacks) {
        callback({
          type: 'preview',
          promptId,
          preview: `data:image/jpeg;base64,${base64}`
        });
      }
    }
  }

  /**
   * Emit progress to registered callback
   */
  emitProgress(promptId, data) {
    const callback = this.progressCallbacks.get(promptId);
    if (callback) {
      callback(data);
    }
    // Also emit as event for external listeners
    this.emit('generation_progress', { promptId, ...data });
  }

  /**
   * Register a progress callback for a prompt
   */
  onProgress(promptId, callback) {
    this.progressCallbacks.set(promptId, callback);
  }

  /**
   * Unregister progress callback
   */
  offProgress(promptId) {
    this.progressCallbacks.delete(promptId);
  }

  /**
   * Get available models (required by Provider Manager)
   */
  getModels() {
    return this.models;
  }

  /**
   * Generate image with progress streaming
   */
  async generateImageWithProgress(options, progressCallback) {
    const {
      model = 'hidream-i1-full',
      prompt,
      negativePrompt = '',
      width = 1024,
      height = 1024,
      steps = 30,
      cfgScale = 7.0,
      seed = -1,
      userId = 'anonymous',
      serviceId = 'image-studio',
      isChildSafe = false
    } = options;
    
    this.requestCount++;
    
    try {
      // Build workflow
      const workflow = this.buildWorkflow(model, {
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed: seed === -1 ? Math.floor(Math.random() * 2147483647) : seed
      });

      // Queue the prompt in ComfyUI with WebSocket client_id for progress streaming
      const queueResponse = await this.httpClient.post('/prompt', {
        prompt: workflow,
        client_id: this.wsClientId || 'ai-gateway-streaming'
      });

      const promptId = queueResponse.data.prompt_id;
      console.log(`[ComfyUI Provider] Queued streaming generation ${promptId} with client_id: ${this.wsClientId}`);
      
      // Register progress callback BEFORE waiting
      this.onProgress(promptId, (progress) => {
        console.log(`[ComfyUI Provider] Progress event for ${promptId}:`, progress.type);
        if (progressCallback) {
          progressCallback(progress);
        }
      });
      
      // Small delay to ensure callback is registered before ComfyUI starts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Wait for completion with progress updates
      const finalResult = await this.waitForCompletion(promptId);
      console.log(`[ComfyUI Provider] Generation ${promptId} completed in ${finalResult.generationTime}ms`);
      this.offProgress(promptId);
      
      await this.logGeneration(userId, serviceId, prompt, model, true);
      
      return {
        success: true,
        promptId,
        images: finalResult.images,
        model,
        seed: finalResult.seed,
        generationTime: finalResult.generationTime
      };
      
    } catch (error) {
      this.errorCount++;
      console.error(`[ComfyUI Provider] Streaming generation failed:`, error.message);
      
      return {
        success: false,
        error: error.message,
        message: 'Image generation failed. Please try again.'
      };
    }
  }

  /**
   * Generate image using ComfyUI
   */
  async generateImage(options) {
    const {
      model = 'hidream-i1-full',
      prompt,
      negativePrompt = '',
      width = 1024,
      height = 1024,
      steps = 30,
      cfgScale = 7.0,
      seed = -1,
      userId = 'anonymous',
      serviceId = 'image-studio',
      isChildSafe = false // Child-safe mode flag from API key
    } = options;
    
    // Child-safe negative prompt additions
    const CHILD_SAFE_NEGATIVE = 'nsfw, nude, naked, violence, blood, gore, scary, horror, weapons, drugs, alcohol, adult content, suggestive, inappropriate';
    
    // Enhance negative prompt for child-safe requests
    let finalNegativePrompt = negativePrompt;
    if (isChildSafe) {
      finalNegativePrompt = negativePrompt 
        ? `${negativePrompt}, ${CHILD_SAFE_NEGATIVE}`
        : CHILD_SAFE_NEGATIVE;
      console.log(`[ComfyUI Provider] Child-safe mode: Enhanced negative prompt`);
    }

    this.requestCount++;

    // Safety filtering handled by AI Gateway (Llama Guard)

    try {
      console.log(`[ComfyUI Provider] Building workflow for model ${model}`);
      console.log(`[ComfyUI Provider] Prompt: "${prompt.substring(0, 100)}"`);
      console.log(`[ComfyUI Provider] Params:`, { width, height, steps, cfgScale, seed });
      
      // Build ComfyUI workflow based on model
      const workflow = this.buildWorkflow(model, {
        prompt,
        negativePrompt: finalNegativePrompt, // Use enhanced negative prompt for child-safe mode
        width,
        height,
        steps,
        cfgScale,
        seed: seed === -1 ? Math.floor(Math.random() * 2147483647) : seed
      });

      console.log(`[ComfyUI Provider] Workflow node 1 inputs:`, JSON.stringify(workflow["1"].inputs));

      // Queue the prompt in ComfyUI
      const queueResponse = await this.httpClient.post('/prompt', {
        prompt: workflow,
        client_id: `ai-gateway-${userId}`
      });

      const promptId = queueResponse.data.prompt_id;
      console.log(`[ComfyUI Provider] Queued generation ${promptId} for user ${userId}`);

      // Poll for completion
      const result = await this.waitForCompletion(promptId);

      // Log successful generation
      await this.logGeneration(userId, serviceId, prompt, model, true);

      return {
        success: true,
        promptId,
        images: result.images,
        model,
        seed: result.seed,
        generationTime: result.generationTime
      };

    } catch (error) {
      this.errorCount++;
      console.error(`[ComfyUI Provider] Generation failed:`, error.message);
      
      await this.logGeneration(userId, serviceId, prompt, model, false);
      
      return {
        success: false,
        error: error.message,
        message: 'Image generation failed. Please try again.'
      };
    }
  }

  /**
   * Build ComfyUI workflow for the specified model
   */
  buildWorkflow(model, params) {
    const { prompt, negativePrompt, width, height, steps, cfgScale, seed } = params;

    // Base workflow structure - this will be customized per model
    // HiDream-I1 workflow using HiDreamSampler custom node
    if (model.startsWith('hidream')) {
      // Map aspect ratio from dimensions
      let aspectRatio = '1:1 (1024×1024)';
      if (width === 768 && height === 1360) aspectRatio = '9:16 (768×1360)';
      else if (width === 1360 && height === 768) aspectRatio = '16:9 (1360×768)';
      else if (width === 880 && height === 1168) aspectRatio = '3:4 (880×1168)';
      else if (width === 1168 && height === 880) aspectRatio = '4:3 (1168×880)';
      else if (width === 1248 && height === 832) aspectRatio = '3:2 (1248×832)';
      else if (width === 832 && height === 1248) aspectRatio = '2:3 (832×1248)';
      
      // Extract model type from model name (remove -nf4 suffix)
      // hidream-i1-full-nf4 -> full, hidream-i1-fast-nf4 -> fast, hidream-i1-dev-nf4 -> dev
      let modelType = 'full';
      if (model.includes('fast')) modelType = 'fast';
      else if (model.includes('dev')) modelType = 'dev';
      
      console.log(`[ComfyUI Provider] Model: ${model} -> Type: ${modelType}`);
      
      return {
        "1": {
          "class_type": "HiDreamSampler",
          "inputs": {
            "model_type": modelType,
            "prompt": prompt,
            "negative_prompt": negativePrompt || "",
            "aspect_ratio": aspectRatio,
            "seed": seed,
            "scheduler": "Default for model",
            "override_steps": steps > 0 ? steps : -1,
            "override_cfg": cfgScale > 0 ? cfgScale : -1,
            "use_alternate_llm": false
          }
        },
        "2": {
          "class_type": "SaveImage",
          "inputs": {
            "images": ["1", 0],
            "filename_prefix": "ai-gateway-hidream"
          }
        }
      };
    }

    // FLUX workflow
    if (model.startsWith('flux')) {
      return {
        "1": {
          "class_type": "CheckpointLoaderSimple",
          "inputs": {
            "ckpt_name": model === 'flux-schnell' ? 'flux1-schnell.safetensors' : 'flux1-dev.safetensors'
          }
        },
        "2": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": prompt,
            "clip": ["1", 1]
          }
        },
        "3": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": negativePrompt || "",
            "clip": ["1", 1]
          }
        },
        "4": {
          "class_type": "EmptyLatentImage",
          "inputs": {
            "width": width,
            "height": height,
            "batch_size": 1
          }
        },
        "5": {
          "class_type": "KSampler",
          "inputs": {
            "model": ["1", 0],
            "positive": ["2", 0],
            "negative": ["3", 0],
            "latent_image": ["4", 0],
            "seed": seed,
            "steps": model === 'flux-schnell' ? 4 : steps,
            "cfg": cfgScale,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1.0
          }
        },
        "6": {
          "class_type": "VAEDecode",
          "inputs": {
            "samples": ["5", 0],
            "vae": ["1", 2]
          }
        },
        "7": {
          "class_type": "SaveImage",
          "inputs": {
            "images": ["6", 0],
            "filename_prefix": "ai-gateway"
          }
        }
      };
    }

    // Default SD 1.5 workflow
    return {
      "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
          "ckpt_name": "v1-5-pruned-emaonly.safetensors"
        }
      },
      "2": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": prompt,
          "clip": ["1", 1]
        }
      },
      "3": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": negativePrompt || "",
          "clip": ["1", 1]
        }
      },
      "4": {
        "class_type": "EmptyLatentImage",
        "inputs": {
          "width": width,
          "height": height,
          "batch_size": 1
        }
      },
      "5": {
        "class_type": "KSampler",
        "inputs": {
          "model": ["1", 0],
          "positive": ["2", 0],
          "negative": ["3", 0],
          "latent_image": ["4", 0],
          "seed": seed,
          "steps": steps,
          "cfg": cfgScale,
          "sampler_name": "euler_ancestral",
          "scheduler": "normal",
          "denoise": 1.0
        }
      },
      "6": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": ["5", 0],
          "vae": ["1", 2]
        }
      },
      "7": {
        "class_type": "SaveImage",
        "inputs": {
          "images": ["6", 0],
          "filename_prefix": "ai-gateway"
        }
      }
    };
  }

  /**
   * Edit an existing image using img2img with SD 1.5
   * Premium feature for non-child accounts
   */
  async editImage(options) {
    const {
      sourceImage, // Base64 encoded image or URL
      prompt,
      negativePrompt = '',
      strength = 0.7, // Denoising strength: 0.0 = no change, 1.0 = complete regeneration
      width = 512,
      height = 512,
      steps = 30,
      cfgScale = 7.0,
      seed = -1,
      userId = 'anonymous',
      serviceId = 'image-studio'
    } = options;

    this.requestCount++;

    // Safety filtering handled by AI Gateway (Llama Guard)

    try {
      console.log(`[ComfyUI Provider] Building img2img workflow for SD 1.5`);
      console.log(`[ComfyUI Provider] Edit prompt: "${prompt.substring(0, 100)}"`);
      console.log(`[ComfyUI Provider] Strength: ${strength}, Steps: ${steps}`);

      // First, upload the source image to ComfyUI
      const uploadedImage = await this.uploadImage(sourceImage, userId);
      if (!uploadedImage.success) {
        return {
          success: false,
          error: 'Failed to upload source image',
          message: uploadedImage.error
        };
      }

      // Build img2img workflow
      const workflow = this.buildImg2ImgWorkflow({
        sourceImageName: uploadedImage.filename,
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        strength,
        seed: seed === -1 ? Math.floor(Math.random() * 2147483647) : seed
      });

      // Queue the prompt in ComfyUI
      const queueResponse = await this.httpClient.post('/prompt', {
        prompt: workflow,
        client_id: `ai-gateway-edit-${userId}`
      });

      const promptId = queueResponse.data.prompt_id;
      console.log(`[ComfyUI Provider] Queued img2img edit ${promptId} for user ${userId}`);

      // Poll for completion
      const result = await this.waitForCompletion(promptId);

      // Log successful edit
      await this.logGeneration(userId, serviceId, `[EDIT] ${prompt}`, 'sd-1.5-img2img', true);

      return {
        success: true,
        promptId,
        images: result.images,
        model: 'sd-1.5-img2img',
        seed: result.seed,
        generationTime: result.generationTime,
        strength
      };

    } catch (error) {
      this.errorCount++;
      console.error(`[ComfyUI Provider] Image edit failed:`, error.message);
      await this.logGeneration(userId, serviceId, `[EDIT] ${prompt}`, 'sd-1.5-img2img', false);
      return {
        success: false,
        error: error.message,
        message: 'Image editing failed. Please try again.'
      };
    }
  }

  /**
   * Upload an image to ComfyUI for img2img processing
   */
  async uploadImage(imageData, userId) {
    try {
      const FormData = require('form-data');
      const formData = new FormData();
      
      let imageBuffer;
      let filename = `upload_${userId}_${Date.now()}.png`;

      if (imageData.startsWith('data:')) {
        // Base64 data URL
        const base64Data = imageData.split(',')[1];
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (imageData.startsWith('http')) {
        // URL - fetch the image
        const response = await axios.get(imageData, { responseType: 'arraybuffer' });
        imageBuffer = Buffer.from(response.data);
      } else {
        // Assume raw base64
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      formData.append('image', imageBuffer, {
        filename,
        contentType: 'image/png'
      });
      formData.append('overwrite', 'true');

      const response = await this.httpClient.post('/upload/image', formData, {
        headers: formData.getHeaders()
      });

      console.log(`[ComfyUI Provider] Uploaded image: ${response.data.name}`);
      return {
        success: true,
        filename: response.data.name,
        subfolder: response.data.subfolder || ''
      };

    } catch (error) {
      console.error(`[ComfyUI Provider] Image upload failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build img2img workflow for SD 1.5
   */
  buildImg2ImgWorkflow(params) {
    const { sourceImageName, prompt, negativePrompt, width, height, steps, cfgScale, strength, seed } = params;

    return {
      "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
          "ckpt_name": "v1-5-pruned-emaonly.safetensors"
        }
      },
      "2": {
        "class_type": "LoadImage",
        "inputs": {
          "image": sourceImageName
        }
      },
      "3": {
        "class_type": "ImageScale",
        "inputs": {
          "image": ["2", 0],
          "width": width,
          "height": height,
          "upscale_method": "lanczos",
          "crop": "center"
        }
      },
      "4": {
        "class_type": "VAEEncode",
        "inputs": {
          "pixels": ["3", 0],
          "vae": ["1", 2]
        }
      },
      "5": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": prompt,
          "clip": ["1", 1]
        }
      },
      "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": negativePrompt || "ugly, blurry, low quality, distorted",
          "clip": ["1", 1]
        }
      },
      "7": {
        "class_type": "KSampler",
        "inputs": {
          "model": ["1", 0],
          "positive": ["5", 0],
          "negative": ["6", 0],
          "latent_image": ["4", 0],
          "seed": seed,
          "steps": steps,
          "cfg": cfgScale,
          "sampler_name": "euler_ancestral",
          "scheduler": "normal",
          "denoise": strength
        }
      },
      "8": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": ["7", 0],
          "vae": ["1", 2]
        }
      },
      "9": {
        "class_type": "SaveImage",
        "inputs": {
          "images": ["8", 0],
          "filename_prefix": "ai-gateway-edit"
        }
      }
    };
  }

  /**
   * Wait for ComfyUI generation to complete
   */
  async waitForCompletion(promptId, timeout = 300000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const historyResponse = await this.httpClient.get(`/history/${promptId}`);
        const history = historyResponse.data[promptId];
        
        if (history && history.outputs) {
          // Find the SaveImage node output
          for (const nodeId of Object.keys(history.outputs)) {
            const output = history.outputs[nodeId];
            if (output.images && output.images.length > 0) {
              const images = await Promise.all(
                output.images.map(async (img) => {
                  // Use AI Gateway proxy URL for external access
                  const gatewayUrl = process.env.AI_GATEWAY_EXTERNAL_URL || `http://localhost:${process.env.EXTERNAL_PORT || 8777}`;
                  const imageUrl = `${gatewayUrl}/api/v1/images/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
                  return {
                    url: imageUrl,
                    filename: img.filename,
                    subfolder: img.subfolder
                  };
                })
              );
              
              return {
                images,
                seed: history.prompt?.[1]?.inputs?.seed || 0,
                generationTime: Date.now() - startTime
              };
            }
          }
        }
        
        // Check if still running
        const queueResponse = await this.httpClient.get('/queue');
        const isRunning = queueResponse.data.queue_running?.some(
          item => item[1] === promptId
        );
        const isPending = queueResponse.data.queue_pending?.some(
          item => item[1] === promptId
        );
        
        if (!isRunning && !isPending && !history) {
          throw new Error('Generation failed or was cancelled');
        }
        
        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        if (error.message.includes('Generation failed')) {
          throw error;
        }
        // Continue polling on network errors
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    throw new Error('Generation timed out');
  }

  /**
   * Log blocked request for parental review
   */
  async logBlockedRequest(userId, prompt, violations) {
    try {
      await this.db.query(`
        INSERT INTO image_generation_audit_log 
        (user_id, prompt, violations, action, created_at)
        VALUES ($1, $2, $3, 'blocked', NOW())
      `, [userId, prompt.substring(0, 500), JSON.stringify(violations)]);
    } catch (error) {
      console.error(`[ComfyUI Provider] Failed to log blocked request:`, error.message);
    }
  }

  /**
   * Log generation for analytics
   */
  async logGeneration(userId, serviceId, prompt, model, success) {
    try {
      await this.db.query(`
        INSERT INTO image_generation_audit_log 
        (user_id, service_id, prompt, model, action, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [userId, serviceId, prompt.substring(0, 200), model, success ? 'generated' : 'failed']);
    } catch (error) {
      // Non-critical, just log
      console.warn(`[ComfyUI Provider] Failed to log generation:`, error.message);
    }
  }

  /**
   * Get provider status
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      models: this.models,
      capabilities: this.capabilities,
      features: this.features,
      stats: {
        requestCount: this.requestCount,
        errorCount: this.errorCount,
        lastHealthCheck: this.lastHealthCheck
      },
      safety: {
        note: 'Safety filtering handled by AI Gateway Llama Guard'
      }
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await this.httpClient.get('/system_stats', { timeout: 5000 });
      this.lastHealthCheck = new Date();
      this.status = 'active';
      return {
        healthy: true,
        latency: response.headers['x-response-time'] || 'N/A',
        gpuMemory: response.data?.devices?.[0]?.vram_free || 'N/A'
      };
    } catch (error) {
      this.status = 'error';
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Shutdown provider
   */
  async shutdown() {
    console.log(`[ComfyUI Provider] Shutting down...`);
    await this.db.end();
    this.status = 'inactive';
    this.emit('shutdown', { provider: this.id });
  }
}

module.exports = ComfyUIProvider;
