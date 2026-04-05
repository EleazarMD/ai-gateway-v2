/**
 * OpenAI-compatible SSE Streaming Middleware
 * Implements proper Server-Sent Events streaming for chat completions
 */

const crypto = require('crypto');

class SSEStreamingHandler {
  /**
   * Handle streaming chat completion request
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} providerRouteFn - Function that routes request to provider
   * @param {Object} options - Additional options (traceId, etc.)
   */
  static async handleStreamingRequest(req, res, providerRouteFn, options = {}) {
    const { traceId } = options;
    let streamedText = '';
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    try {
      // Call the provider route function with streaming callback
      await providerRouteFn(req.body, {
        ...options,
        stream: true,
        onChunk: (chunk) => {
          const chunkText = this.extractChunkText(chunk);
          if (chunkText) {
            streamedText += chunkText;
          }
          // Send chunk in OpenAI SSE format
          this.sendSSEChunk(res, chunk);
        },
        onComplete: (finalData) => {
          const finalText = this.extractChunkText(finalData);
          const streamHash = this.hashText(streamedText);
          const finalHash = this.hashText(finalText);

          if (finalText && streamHash !== finalHash) {
            console.warn(`[SSE Streaming] Stream/final mismatch [Trace: ${traceId}] STREAM_HASH=${streamHash} FINAL_HASH=${finalHash}`);
          } else {
            console.log(`[SSE Streaming] Stream/final match [Trace: ${traceId}] STREAM_HASH=${streamHash} FINAL_HASH=${finalHash}`);
          }

          // Send final chunk with finish_reason (no content)
          const finishReason = finalData?.finish_reason || 'stop';
          const model = finalData?.model || 'unknown';
          this.sendSSEChunk(res, { model, finish_reason: finishReason }, true);

          // Send [DONE] marker
          res.write('data: [DONE]\n\n');
          res.end();
        },
        onError: (error) => {
          // Send error in SSE format
          this.sendSSEError(res, error);
          res.end();
        }
      });
      
    } catch (error) {
      console.error('[SSE Streaming] Error:', error);
      this.sendSSEError(res, error);
      res.end();
    }
  }
  
  /**
   * Send a chunk in OpenAI SSE format
   */
  static sendSSEChunk(res, chunk, isFinal = false) {
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Convert chunk to OpenAI format if needed
    const sseChunk = {
      id: chunk.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: chunk.created || timestamp,
      model: chunk.model || 'unknown',
      choices: [{
        index: 0,
        delta: isFinal ? {} : { content: chunk.content || chunk.reasoning_content || chunk.text || '' },
        finish_reason: isFinal ? (chunk.finish_reason || 'stop') : null
      }]
    };
    
    // Send as SSE event
    res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
  }
  
  /**
   * Send error in SSE format
   */
  static sendSSEError(res, error) {
    const errorChunk = {
      error: {
        message: error.message || 'Unknown error',
        type: error.type || 'api_error',
        code: error.code || 'internal_error'
      }
    };
    
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
  }

  /**
   * Extract text content from a chunk for checksum validation
   */
  static extractChunkText(chunk) {
    if (!chunk) return '';
    if (typeof chunk === 'string') return chunk;
    return chunk.content || chunk.reasoning_content || chunk.text || chunk.delta?.content || chunk.delta?.reasoning_content || chunk.delta?.text || '';
  }

  /**
   * Hash text for streaming checksum verification
   */
  static hashText(text) {
    return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
  }
  
  /**
   * Convert provider response to OpenAI streaming format
   * @param {Object} providerResponse - Response from provider (Anthropic, etc.)
   * @param {String} provider - Provider name
   * @returns {Object} OpenAI-formatted chunk
   */
  static convertToOpenAIFormat(providerResponse, provider = 'unknown') {
    // Handle Anthropic format
    if (provider === 'anthropic' || providerResponse.type) {
      if (providerResponse.type === 'content_block_delta') {
        return {
          content: providerResponse.delta?.text || '',
          model: providerResponse.model
        };
      }
      if (providerResponse.type === 'message_stop' || providerResponse.type === 'content_block_stop') {
        return {
          content: '',
          finish_reason: 'stop',
          model: providerResponse.model
        };
      }
    }
    
    // Handle OpenAI format (pass through)
    if (providerResponse.choices && providerResponse.choices[0]) {
      const choice = providerResponse.choices[0];
      return {
        content: choice.delta?.content || choice.delta?.reasoning_content || choice.text || '',
        finish_reason: choice.finish_reason,
        model: providerResponse.model
      };
    }
    
    // Default: extract text content
    return {
      content: providerResponse.content || providerResponse.text || '',
      model: providerResponse.model
    };
  }
}

module.exports = SSEStreamingHandler;
