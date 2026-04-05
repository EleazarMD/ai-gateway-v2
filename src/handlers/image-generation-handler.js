/**
 * Image Generation Handler
 * Handles image generation requests with centralized Llama Guard 3 safety filtering
 */

class ImageGenerationHandler {
  constructor(inferencingClient) {
    this.inferencingClient = inferencingClient;
  }
  
  /**
   * Handle image generation request
   */
  async handle(req, res) {
    try {
      const {
        prompt,
        negative_prompt,
        model = 'hidream-i1-full-nf4',
        width = 1024,
        height = 1024,
        steps,
        cfg_scale,
        seed = -1,
        safetyLevel,
        userSafetyLevel,
        userId,
        isChild
      } = req.body;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          error: {
            message: 'prompt is required',
            type: 'invalid_request_error',
            param: 'prompt'
          }
        });
      }

      // Extract service metadata
      const serviceId = req.headers['x-service-id'] || 'ai-gateway';
      const projectId = req.headers['x-project-id'] || 'default';
      
      // Determine safety level from user-specific setting (database-driven)
      // Priority: enforcedSafetyLevel (from API key) > userSafetyLevel (from DB) > safetyLevel (legacy) > default
      const effectiveSafetyLevel = req.enforcedSafetyLevel || userSafetyLevel || safetyLevel || (isChild ? 'strict' : 'standard');
      const context = (req.isChildRequest || isChild) ? 'child' : 'general';

      console.log(`[Image Generation] ========== SAFETY LEVEL DEBUG ==========`);
      console.log(`[Image Generation] userSafetyLevel from request: ${userSafetyLevel}`);
      console.log(`[Image Generation] safetyLevel from request: ${safetyLevel}`);
      console.log(`[Image Generation] isChild: ${isChild}`);
      console.log(`[Image Generation] effectiveSafetyLevel: ${effectiveSafetyLevel}`);
      console.log(`[Image Generation] context: ${context}`);
      console.log(`[Image Generation] userId: ${userId}`);
      console.log(`[Image Generation] ==========================================`);

      // STEP 1: Check if user has moderation disabled (e.g., administrators)
      if (effectiveSafetyLevel === 'unrestricted' || effectiveSafetyLevel === 'none' || effectiveSafetyLevel === 'disabled' || effectiveSafetyLevel === 'off') {
        console.log(`[Image Generation] ⚠️  Safety filtering DISABLED for user ${userId} (safety level: ${effectiveSafetyLevel})`);
        // Skip all safety checks - proceed directly to generation
      } else {
        // STEP 2: Check prompt safety with Llama Guard 3 (centralized filtering)
        console.log(`[Image Generation] Checking prompt safety with Llama Guard 3...`);
        const promptSafetyCheck = await this.inferencingClient.checkContentSafety(
          prompt,
          effectiveSafetyLevel,
          context
        );

        if (!promptSafetyCheck.safe) {
          console.warn(`[Image Generation] Prompt blocked by Llama Guard 3: ${promptSafetyCheck.reasoning}`);
          return res.status(400).json({
            error: {
              message: promptSafetyCheck.reasoning || 'Content blocked by safety filter',
              type: 'content_policy_violation',
              code: 'content_blocked',
              safetyLevel: effectiveSafetyLevel,
              violations: promptSafetyCheck.violations
            }
          });
        }

        // STEP 3: Check negative prompt safety if provided
        if (negative_prompt && negative_prompt.trim().length > 0) {
          console.log(`[Image Generation] Checking negative prompt safety with Llama Guard 3...`);
          const negPromptSafetyCheck = await this.inferencingClient.checkContentSafety(
            negative_prompt,
            effectiveSafetyLevel,
            context
          );

          if (!negPromptSafetyCheck.safe) {
            console.warn(`[Image Generation] Negative prompt blocked by Llama Guard 3: ${negPromptSafetyCheck.reasoning}`);
            return res.status(400).json({
              error: {
                message: `Negative prompt: ${negPromptSafetyCheck.reasoning}` || 'Negative prompt blocked by safety filter',
                type: 'content_policy_violation',
                code: 'content_blocked',
                safetyLevel: effectiveSafetyLevel,
                violations: negPromptSafetyCheck.violations
              }
            });
          }
        }

        console.log(`[Image Generation] ✅ Content passed Llama Guard 3 safety check (level: ${effectiveSafetyLevel})`);
      }

      // STEP 3: Forward to AI Inferencing Service (no safety filtering there)
      const response = await this.inferencingClient.generateImage({
        prompt,
        negative_prompt,
        model,
        width,
        height,
        steps,
        cfg_scale,
        seed,
        userId,
        serviceId,
        projectId
      });

      // Return success response
      res.json(response);

    } catch (error) {
      console.error('[Image Generation] Error:', error);
      
      res.status(500).json({
        error: {
          message: error.message || 'Image generation failed',
          type: 'server_error',
          code: 'generation_failed'
        }
      });
    }
  }

  /**
   * Handle streaming image generation request
   */
  async handleStream(req, res) {
    try {
      const {
        prompt,
        negative_prompt,
        model = 'hidream-i1-full-nf4',
        width = 1024,
        height = 1024,
        steps,
        cfg_scale,
        seed = -1,
        safetyLevel,
        userSafetyLevel,
        userId,
        isChild
      } = req.body;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          error: {
            message: 'prompt is required',
            type: 'invalid_request_error',
            param: 'prompt'
          }
        });
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Extract service metadata
      const serviceId = req.headers['x-service-id'] || 'ai-gateway';
      const projectId = req.headers['x-project-id'] || 'default';
      
      // Determine safety level from user-specific setting (database-driven)
      // Priority: enforcedSafetyLevel (from API key) > userSafetyLevel (from DB) > safetyLevel (legacy) > default
      const effectiveSafetyLevel = req.enforcedSafetyLevel || userSafetyLevel || safetyLevel || (isChild ? 'strict' : 'standard');
      const context = (req.isChildRequest || isChild) ? 'child' : 'general';

      console.log(`[Image Generation Stream] Request from ${serviceId}, userId: ${userId}, model: ${model}, safetyLevel: ${effectiveSafetyLevel}, context: ${context}`);

      // Send initial progress
      sendEvent('progress', { progress: 0, message: 'Checking content safety...' });

      try {
        // STEP 1: Check if user has moderation disabled (e.g., administrators)
        if (effectiveSafetyLevel === 'none' || effectiveSafetyLevel === 'disabled' || effectiveSafetyLevel === 'off') {
          console.log(`[Image Generation Stream] ⚠️  Safety filtering DISABLED for user ${userId} (admin/special permission)`);
          sendEvent('progress', { progress: 10, message: 'Starting generation...' });
          // Skip all safety checks - proceed directly to generation
        } else {
          // STEP 2: Check prompt safety with Llama Guard 3
          const promptSafetyCheck = await this.inferencingClient.checkContentSafety(
            prompt,
            effectiveSafetyLevel,
            context
          );

          if (!promptSafetyCheck.safe) {
            console.warn(`[Image Generation Stream] Prompt blocked by Llama Guard 3: ${promptSafetyCheck.reasoning}`);
            sendEvent('error', {
              message: promptSafetyCheck.reasoning || 'Content blocked by safety filter',
              type: 'content_policy_violation',
              safetyLevel: effectiveSafetyLevel,
              violations: promptSafetyCheck.violations
            });
            return res.end();
          }

          // STEP 3: Check negative prompt safety if provided
          if (negative_prompt && negative_prompt.trim().length > 0) {
            const negPromptSafetyCheck = await this.inferencingClient.checkContentSafety(
              negative_prompt,
              effectiveSafetyLevel,
              context
            );

            if (!negPromptSafetyCheck.safe) {
              console.warn(`[Image Generation Stream] Negative prompt blocked by Llama Guard 3: ${negPromptSafetyCheck.reasoning}`);
              sendEvent('error', {
                message: `Negative prompt: ${negPromptSafetyCheck.reasoning}` || 'Negative prompt blocked by safety filter',
                type: 'content_policy_violation',
                safetyLevel: effectiveSafetyLevel,
                violations: negPromptSafetyCheck.violations
              });
              return res.end();
            }
          }

          console.log(`[Image Generation Stream] ✅ Content passed Llama Guard 3 safety check (level: ${effectiveSafetyLevel})`);
          sendEvent('progress', { progress: 10, message: 'Starting generation...' });
        }

        // STEP 3: Forward to AI Inferencing Service
        const response = await this.inferencingClient.generateImage({
          prompt,
          negative_prompt,
          model,
          width,
          height,
          steps,
          cfg_scale,
          seed,
          userId,
          serviceId,
          projectId
        });

        // Send completion event
        sendEvent('complete', response);
        res.end();

      } catch (error) {
        console.error('[Image Generation Stream] Error:', error);
        sendEvent('error', {
          message: error.message || 'Image generation failed',
          type: 'server_error'
        });
        res.end();
      }

    } catch (error) {
      console.error('[Image Generation Stream] Setup error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: error.message || 'Failed to start image generation',
            type: 'server_error'
          }
        });
      }
    }
  }
}

module.exports = ImageGenerationHandler;
