#!/bin/bash

# Security Integration Test Runner
# Runs all security-related tests

echo "=================================="
echo "Security Integration Test Suite"
echo "=================================="
echo ""

# Check if PostgreSQL is running
echo "Checking PostgreSQL connection..."
if psql -h localhost -U eleazar -d ai_gateway_db -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL is accessible"
else
    echo "❌ PostgreSQL is not accessible"
    echo "Please ensure PostgreSQL is running and ai_gateway_db exists"
    exit 1
fi

# Check if tables exist
echo ""
echo "Checking database schema..."
TABLES=("security_anomalies" "audit_events" "security_metrics" "api_keys" "approval_requests" "security_health_checks")

for table in "${TABLES[@]}"; do
    if psql -h localhost -U eleazar -d ai_gateway_db -c "SELECT 1 FROM $table LIMIT 1;" > /dev/null 2>&1; then
        echo "✅ Table $table exists"
    else
        echo "❌ Table $table does not exist"
        echo "Please run migrations first"
        exit 1
    fi
done

echo ""
echo "=================================="
echo "Running Jest tests..."
echo "=================================="
echo ""

# Run Jest tests
npm test -- tests/security-integration.test.js

echo ""
echo "=================================="
echo "Test suite completed"
echo "=================================="
