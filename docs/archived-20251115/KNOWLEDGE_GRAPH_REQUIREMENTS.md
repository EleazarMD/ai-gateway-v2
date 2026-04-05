# Knowledge Graph System Requirements for AI Gateway Integration

## Executive Summary
The Knowledge Graph database is operational with proper schema and minimal test data, but lacks API integration with the AI Gateway. Users requesting Knowledge Graph queries through the AI Gateway receive generic responses instead of accessing actual graph data.

## Current Infrastructure Status

### Database Status: ✅ OPERATIONAL
- **Database**: `knowledge_graph` 
- **Connection**: `host.docker.internal:5432`
- **User**: `eleazar`
- **Status**: Connected and accessible from AI Gateway k3d cluster

### Schema Analysis ✅ COMPLETE

| Table | Purpose | Records | Key Features |
|-------|---------|---------|-------------|
| `documents` | Document storage | 0 | ID, path, content, metadata, timestamps |
| `knowledge_documents` | Knowledge entities | 1 | Content hashing, metadata, embeddings |
| `vector_embeddings` | Vector search | 1 | Content types, sources, embeddings |
| `schema_migrations` | Version control | 1 | Migration tracking |

### Current Data Sample
```json
Knowledge Documents:
- ID: 1, Hash: "test_doc...", Type: "test", Source: "init", Version: "1.0"

Vector Embeddings: 
- ID: 1, Type: "test", Source: "init_script"
```

### Database Indexes ✅ OPTIMIZED
- Content hash indexing for deduplication
- Metadata JSONB indexing for fast queries
- Source and content type indexing for filtering
- Migration version tracking

## Integration Gap Analysis

### Missing Components

1. **Knowledge Graph API Layer** ❌
   - No `/api/knowledge-graph/*` endpoints
   - No entity relationship queries
   - No semantic search capabilities
   - No graph traversal APIs

2. **AI Gateway Integration** ❌
   - No proxy routes to Knowledge Graph service
   - No query parsing for graph requests
   - No response formatting for graph data

3. **Query Processing Service** ❌
   - No natural language to graph query translation
   - No entity extraction from user queries
   - No relationship mapping

## User Experience Issues

### Current Problem
When users ask Knowledge Graph questions like:
- "Show me the relationship between authentication and user-management services"
- "What components depend on the PostgreSQL database?"
- "Find all services in the AI ecosystem"

**Current Response**: Generic suggestions instead of actual graph data

**Expected Response**: Specific entity relationships, dependency graphs, and component mappings

## Required Development Work

### Phase 1: Knowledge Graph API Service (Priority: HIGH)

Create a dedicated Knowledge Graph service that provides:

```javascript
// Required API Endpoints
GET  /api/kg/entities              // List all entities
GET  /api/kg/entities/:id          // Get specific entity
GET  /api/kg/relationships         // Get relationships  
GET  /api/kg/query                 // Natural language queries
POST /api/kg/search                // Semantic search
GET  /api/kg/dependencies/:id      // Dependency graph
GET  /api/kg/health               // Service health
```

### Phase 2: AI Gateway Proxy Integration (Priority: HIGH)

Add Knowledge Graph routing to AI Gateway `server.js`:

```javascript
// Knowledge Graph Proxy Routes
app.use('/api/kg/*', authenticateExternal, (req, res) => {
  proxy.web(req, res, { 
    target: 'http://localhost:8889',  // KG Service port
    changeOrigin: true,
    onError: (err) => {
      console.error('[KG-PROXY] Error:', err.message);
      res.status(503).json({ error: 'Knowledge Graph service unavailable' });
    }
  });
});

// Natural Language Query Processing
app.post('/api/v1/knowledge/query', authenticateExternal, async (req, res) => {
  // Parse natural language queries and route to KG service
  const { query } = req.body;
  // Process and forward to KG service
});
```

### Phase 3: Query Intelligence Layer (Priority: MEDIUM)

Implement natural language processing for Knowledge Graph queries:

```javascript
// Query Pattern Recognition
const queryPatterns = {
  dependencies: /what.*depends.*on|dependencies.*of|connected.*to/i,
  relationships: /relationship.*between|how.*related|connection/i,
  entities: /show.*entities|list.*components|find.*services/i,
  search: /search.*for|find.*similar|related.*to/i
};

// Query Router
function parseKnowledgeGraphQuery(naturalLanguageQuery) {
  // Extract entities, relationships, and intent
  // Return structured query for KG service
}
```

## Database Connection Code

### Knowledge Graph Pool Configuration
```javascript
const { Pool } = require('pg');

const knowledgeGraphPool = new Pool({
  host: 'host.docker.internal',
  port: 5432,
  database: 'knowledge_graph',
  user: 'eleazar',
  password: '',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Health Check Query
async function checkKnowledgeGraphHealth() {
  try {
    const result = await knowledgeGraphPool.query('SELECT COUNT(*) as entities FROM knowledge_documents');
    return { status: 'ok', entities: result.rows[0].entities };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}
```

### Sample Queries for Development

```sql
-- Get all entities with relationships
SELECT 
  kd.id,
  kd.metadata->>'type' as entity_type,
  kd.metadata->>'name' as entity_name,
  kd.content,
  kd.created_at
FROM knowledge_documents kd
WHERE kd.metadata->>'status' = 'active';

-- Search by entity type
SELECT * FROM knowledge_documents 
WHERE metadata->>'type' = 'service'
  OR metadata->>'type' = 'component';

-- Vector similarity search (when populated)
SELECT 
  ve.id,
  ve.source,
  ve.content_type,
  ve.metadata
FROM vector_embeddings ve
WHERE ve.content_type = 'service_definition';
```

## Port Registry Compliance

### Knowledge Graph Service Requirements
- **Assigned Port**: Verify PORT_REGISTRY.yml for KG service port assignment
- **Service Registration**: Register with AHIS server at startup
- **Health Monitoring**: Implement health checks on assigned port
- **Load Balancer**: Configure k3d LoadBalancer service if external access needed

## Implementation Timeline

### Week 1: Foundation
- [ ] Create Knowledge Graph API service skeleton
- [ ] Implement basic entity CRUD operations
- [ ] Add health check endpoint
- [ ] Test database connectivity

### Week 2: AI Gateway Integration  
- [ ] Add proxy routes to AI Gateway
- [ ] Implement authentication passthrough
- [ ] Test end-to-end connectivity
- [ ] Add error handling

### Week 3: Query Intelligence
- [ ] Implement natural language query parsing
- [ ] Add relationship traversal APIs
- [ ] Create semantic search endpoints
- [ ] Test with real user queries

### Week 4: Production Readiness
- [ ] Add comprehensive logging
- [ ] Implement caching layer
- [ ] Performance optimization
- [ ] Documentation and testing

## Success Criteria

### Functional Requirements ✅
- [ ] Users can query Knowledge Graph through AI Gateway
- [ ] Natural language queries return actual graph data
- [ ] Entity relationships are traversable via API
- [ ] Search functionality works across all entity types

### Performance Requirements
- [ ] Query response time < 500ms for simple queries
- [ ] Support for 100+ concurrent users
- [ ] Proper error handling and fallbacks
- [ ] 99.9% uptime SLA

### Integration Requirements  
- [ ] Seamless AI Gateway proxy routing
- [ ] Proper authentication enforcement
- [ ] Consistent API response formats
- [ ] AHIS server registration and monitoring

## Resource Requirements

### Development Resources
- **Backend Developer**: Knowledge Graph API service
- **Integration Engineer**: AI Gateway proxy implementation  
- **Data Engineer**: Schema optimization and indexing
- **QA Engineer**: End-to-end testing

### Infrastructure Requirements
- **Port Assignment**: Dedicated port for KG service (check PORT_REGISTRY.yml)
- **k3d Service**: Deployment manifest for KG service
- **Database Optimization**: Index tuning for large datasets
- **Monitoring**: Health checks and performance metrics

## Risk Assessment

### High Risk Items
- **Complex Query Performance**: Large graph traversals may be slow
- **Data Model Evolution**: Schema changes affect existing integrations
- **Memory Usage**: Vector embeddings storage requirements

### Mitigation Strategies
- Implement query result caching
- Use database connection pooling
- Add query complexity limits
- Implement incremental schema migrations

---

## Contact Information

**Requesting Team**: AI Gateway Team  
**Report Generated**: 2025-09-11 03:33 UTC  
**AI Gateway Version**: v2.1.0  
**Database Status**: ✅ Ready for integration  
**Next Review**: After Phase 1 completion

**Technical Contacts**:
- Database Access: Validated ✅
- Schema Design: Reviewed ✅  
- Integration Points: Documented ✅
- Port Assignments: Pending verification with PORT_REGISTRY.yml

For questions or clarification, reference this document and the accompanying `DATABASE_CONNECTIONS_REPORT.md` for complete infrastructure context.
