# AI Gateway Database Architecture
## Formalized Persistent Database Configuration

### Overview
The AI Gateway uses a formalized database architecture that supports seamless transitions between development, staging, and production environments with different database providers.

## Architecture Principles

### 1. Environment-Based Configuration
```
Development → Local PostgreSQL (Homebrew)
Staging     → Cloud Database (AWS RDS, GCP Cloud SQL, etc.)
Production  → Managed Database Service with High Availability
```

### 2. Database Connection Abstraction
All database connections use a standardized configuration interface that supports:
- Connection pooling
- SSL/TLS encryption
- Connection retry logic
- Health monitoring
- Failover capabilities

### 3. Provider Agnostic Design
The system supports multiple database providers through environment variables:
- PostgreSQL (Local, AWS RDS, GCP Cloud SQL, Azure Database)
- MySQL (AWS RDS, GCP Cloud SQL, Azure Database)
- Cloud-native databases (AWS Aurora, GCP Spanner)

## Configuration Structure

### Environment Variables
```bash
# Database Provider Configuration
DATABASE_PROVIDER=postgresql|mysql|aurora|spanner
DATABASE_URL=<full_connection_string>

# Alternative: Individual Parameters
DATABASE_HOST=<hostname>
DATABASE_PORT=<port>
DATABASE_NAME=<database_name>
DATABASE_USER=<username>
DATABASE_PASSWORD=<password>
DATABASE_SSL_MODE=require|prefer|disable

# Connection Pool Settings
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_POOL_IDLE_TIMEOUT=30000
DATABASE_CONNECTION_TIMEOUT=10000

# High Availability
DATABASE_READ_REPLICA_URL=<read_replica_connection>
DATABASE_FAILOVER_ENABLED=true
```

### Configuration Hierarchy
1. **DATABASE_URL** (highest priority) - Full connection string
2. **Individual parameters** - Host, port, database, user, password
3. **Environment defaults** - Development fallbacks

## Environment-Specific Configurations

### Development Environment
```yaml
# Local PostgreSQL@14 via Homebrew
DATABASE_PROVIDER: postgresql
DATABASE_HOST: localhost
DATABASE_PORT: 5432
DATABASE_NAME: ai_gateway_db
DATABASE_USER: eleazar
DATABASE_SSL_MODE: disable
```

### Staging Environment
```yaml
# AWS RDS PostgreSQL
DATABASE_PROVIDER: postgresql
DATABASE_URL: postgresql://username:password@staging-db.cluster-xyz.us-west-2.rds.amazonaws.com:5432/ai_gateway_staging
DATABASE_SSL_MODE: require
DATABASE_POOL_MAX: 10
```

### Production Environment
```yaml
# AWS Aurora PostgreSQL with Read Replicas
DATABASE_PROVIDER: aurora
DATABASE_URL: postgresql://username:password@prod-db.cluster-xyz.us-west-2.rds.amazonaws.com:5432/ai_gateway_prod
DATABASE_READ_REPLICA_URL: postgresql://username:password@prod-db-ro.cluster-xyz.us-west-2.rds.amazonaws.com:5432/ai_gateway_prod
DATABASE_SSL_MODE: require
DATABASE_POOL_MAX: 50
DATABASE_FAILOVER_ENABLED: true
```

## Cloud Provider Templates

### AWS RDS PostgreSQL
```yaml
DATABASE_PROVIDER: postgresql
DATABASE_URL: postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_ENDPOINT}:5432/${DB_NAME}
DATABASE_SSL_MODE: require
DATABASE_POOL_MAX: 20
```

### Google Cloud SQL PostgreSQL
```yaml
DATABASE_PROVIDER: postgresql
DATABASE_URL: postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_PRIVATE_IP}:5432/${DB_NAME}
DATABASE_SSL_MODE: require
DATABASE_POOL_MAX: 20
```

### Azure Database for PostgreSQL
```yaml
DATABASE_PROVIDER: postgresql
DATABASE_URL: postgresql://${DB_USERNAME}@${DB_SERVER}:${DB_PASSWORD}@${DB_SERVER}.postgres.database.azure.com:5432/${DB_NAME}
DATABASE_SSL_MODE: require
DATABASE_POOL_MAX: 20
```

## Migration Strategy

### Schema Management
- Use database migration tools (e.g., Flyway, Liquibase)
- Version-controlled schema changes
- Rollback capabilities
- Environment-specific migrations

### Data Migration
- Export/import tools for provider transitions
- Data validation and integrity checks
- Minimal downtime migration strategies
- Backup verification before migration

## Security Considerations

### Connection Security
- TLS/SSL encryption for all connections
- Certificate validation
- Connection string encryption at rest
- Secrets management integration (AWS Secrets Manager, etc.)

### Access Control
- Principle of least privilege
- Database user role separation
- Network security groups/firewall rules
- VPC/private network isolation

## Monitoring and Observability

### Health Checks
- Connection pool monitoring
- Query performance metrics
- Database availability monitoring
- Automated failover detection

### Logging
- Connection events
- Query performance logs
- Error tracking and alerting
- Audit trail for data access

## Implementation Files

### Core Configuration
- `src/storage/database-config.js` - Database configuration manager
- `src/storage/connection-pool.js` - Connection pooling implementation
- `src/storage/health-monitor.js` - Database health monitoring

### Environment Configs
- `config/database/development.yaml` - Local development settings
- `config/database/staging.yaml` - Staging environment settings
- `config/database/production.yaml` - Production environment settings

### Deployment Templates
- `deploy/aws/rds-postgresql.yaml` - AWS RDS deployment
- `deploy/gcp/cloud-sql.yaml` - GCP Cloud SQL deployment
- `deploy/azure/postgres.yaml` - Azure Database deployment
