# Safety Level Testing Guide

## Test Scenarios

### Test 1: Permissive User with Copyrighted Characters
**Expected**: Should PASS (S8 not checked for permissive users)

```bash
# User with permissive safety level
curl -X POST http://localhost:8777/api/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -d '{
    "prompt": "Sonic the Hedgehog running through Green Hill Zone",
    "model": "hidream-i1-full-nf4",
    "width": 1024,
    "height": 1024,
    "userSafetyLevel": "permissive",
    "userId": "test-user-permissive"
  }'
```

**Check logs for**:
```
[Image Generation] userSafetyLevel from request: permissive
[Image Generation] effectiveSafetyLevel: permissive
[Semantic Moderation] checkContent called with level: permissive
[Semantic Moderation] Categories being checked: S1, S3, S4, S10
```

### Test 2: Standard User with Copyrighted Characters
**Expected**: Should PASS (S8 not checked for standard users)

```bash
curl -X POST http://localhost:8777/api/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -d '{
    "prompt": "Mario jumping on a Goomba",
    "model": "hidream-i1-full-nf4",
    "userSafetyLevel": "standard",
    "userId": "test-user-standard"
  }'
```

**Check logs for**:
```
[Semantic Moderation] Categories being checked: S1, S3, S4, S9, S10, S11, S12
```

### Test 3: Strict User with Copyrighted Characters
**Expected**: Should FAIL (S8 checked for strict users)

```bash
curl -X POST http://localhost:8777/api/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -d '{
    "prompt": "Mickey Mouse waving",
    "model": "hidream-i1-full-nf4",
    "userSafetyLevel": "strict",
    "userId": "test-user-strict"
  }'
```

**Check logs for**:
```
[Semantic Moderation] Categories being checked: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13
[Image Generation] Prompt blocked by Llama Guard 3: Content violates safety policies: Intellectual Property
```

### Test 4: Administrator with No Filtering
**Expected**: Should PASS (all filtering bypassed)

```bash
curl -X POST http://localhost:8777/api/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -d '{
    "prompt": "Explicit violent scene with copyrighted characters",
    "model": "hidream-i1-full-nf4",
    "userSafetyLevel": "none",
    "userId": "admin-user"
  }'
```

**Check logs for**:
```
[Image Generation] ⚠️  Safety filtering DISABLED for user admin-user (admin/special permission)
```

### Test 5: Permissive User with Actually Harmful Content
**Expected**: Should FAIL (S1, S3, S4, S10 still checked)

```bash
curl -X POST http://localhost:8777/api/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -d '{
    "prompt": "graphic violent crime scene with blood",
    "model": "hidream-i1-full-nf4",
    "userSafetyLevel": "permissive",
    "userId": "test-user-permissive"
  }'
```

**Check logs for**:
```
[Image Generation] Prompt blocked by Llama Guard 3: Content violates safety policies: Violent Crimes
```

## Debugging Steps

### 1. Check AI Gateway Logs
```bash
docker logs ai-gateway-v2 --tail=100 -f
```

Look for:
- `[Image Generation] ========== SAFETY LEVEL DEBUG ==========`
- `userSafetyLevel from request`
- `effectiveSafetyLevel`

### 2. Check AI Inferencing Logs
```bash
docker logs ai-inferencing --tail=100 -f
```

Look for:
- `[Semantic Moderation] checkContent called with level:`
- `[Semantic Moderation] Categories being checked:`

### 3. Verify Request Payload
Add this to Dashboard code to log what's being sent:
```javascript
console.log('Sending to AI Gateway:', {
  prompt,
  userSafetyLevel,
  userId
});
```

## Common Issues

### Issue 1: Safety Level Not Being Passed
**Symptom**: Logs show `userSafetyLevel from request: undefined`

**Fix**: Ensure Dashboard is sending `userSafetyLevel` in request body:
```javascript
body: JSON.stringify({
  prompt,
  userSafetyLevel,  // ← Must be included
  userId: session.user.id
})
```

### Issue 2: Wrong Safety Level Applied
**Symptom**: `effectiveSafetyLevel` doesn't match `userSafetyLevel`

**Fix**: Check priority order in AI Gateway:
```javascript
const effectiveSafetyLevel = userSafetyLevel || safetyLevel || (isChild ? 'strict' : 'standard');
```

### Issue 3: S8 Still Being Checked for Permissive Users
**Symptom**: Copyrighted characters blocked even with `permissive` level

**Fix**: Verify semantic moderation service categories:
```javascript
'permissive': [
  'S1', 'S3', 'S4', 'S10'  // ← S8 should NOT be here
]
```

### Issue 4: Llama Guard Not Respecting Categories
**Symptom**: Categories logged correctly but still blocking

**Fix**: Check Llama Guard prompt construction:
```javascript
const categories = categoryIds.map(id => `${id}: ${this.safetyCategories[id]}`).join('\n');
// Should only include S1, S3, S4, S10 for permissive
```

## Expected Log Flow (Permissive User)

```
[Dashboard] User safety level: permissive
[Dashboard] Sending to AI Gateway with userSafetyLevel: permissive
↓
[AI Gateway] ========== SAFETY LEVEL DEBUG ==========
[AI Gateway] userSafetyLevel from request: permissive
[AI Gateway] effectiveSafetyLevel: permissive
[AI Gateway] Checking prompt safety with Llama Guard 3...
↓
[AI Inferencing Client] Checking content safety with Llama Guard 3: level=permissive
↓
[Semantic Moderation] checkContent called with level: permissive, context: general
[Semantic Moderation] Building prompt with level: permissive, effectiveLevel: permissive
[Semantic Moderation] Categories being checked: S1, S3, S4, S10
↓
[Llama Guard 3] Checking against 4 categories (no S8)
↓
[Semantic Moderation] Result: safe=true
↓
[AI Gateway] ✅ Content passed Llama Guard 3 safety check (level: permissive)
[AI Gateway] Forwarding to AI Inferencing for image generation
```

## Verification Checklist

- [ ] Dashboard reads `user.settings.safety_level` from database
- [ ] Dashboard sends `userSafetyLevel` in request to AI Gateway
- [ ] AI Gateway logs show correct `userSafetyLevel` received
- [ ] AI Gateway logs show correct `effectiveSafetyLevel` calculated
- [ ] AI Inferencing logs show correct `level` parameter received
- [ ] Semantic Moderation logs show correct categories for level
- [ ] Llama Guard prompt only includes categories for that level
- [ ] Permissive users can generate copyrighted character images
- [ ] Permissive users still blocked for harmful content (S1, S3, S4, S10)
