# User-Specific Safety Levels with Llama Guard 3

## Overview

All content safety filtering is centralized at the AI Gateway using **Llama Guard 3** (Meta's semantic content moderation model). Each user has a configurable safety level stored in the database that determines which Llama Guard categories are enforced.

## Safety Levels

### 1. **None/Disabled/Off** (Administrators)
- **Database value**: `none`, `disabled`, or `off`
- **Llama Guard categories**: None - all filtering bypassed
- **Use case**: AI administrators, content moderators
- **Behavior**: No safety checks performed, all content allowed

### 2. **Permissive** (Advanced Users)
- **Database value**: `permissive`
- **Llama Guard categories**: 4 categories
  - S1: Violent Crimes
  - S3: Sex-Related Crimes
  - S4: Child Sexual Exploitation
  - S10: Hate
- **Use case**: Adult users, creative professionals
- **Allows**: Intellectual property content (S8), specialized advice (S6), non-violent crimes (S2), sexual content (S12)

### 3. **Standard** (Default Adults)
- **Database value**: `standard` (default for adult accounts)
- **Llama Guard categories**: 7 categories
  - S1: Violent Crimes
  - S3: Sex-Related Crimes
  - S4: Child Sexual Exploitation
  - S9: Indiscriminate Weapons
  - S10: Hate
  - S11: Suicide & Self-Harm
  - S12: Sexual Content
- **Use case**: General adult users
- **Allows**: Intellectual property content (S8), specialized advice (S6), non-violent crimes (S2)

### 4. **Strict** (Children & Family Accounts)
- **Database value**: `strict` (default for child accounts)
- **Llama Guard categories**: All 13 categories
  - S1: Violent Crimes
  - S2: Non-Violent Crimes
  - S3: Sex-Related Crimes
  - S4: Child Sexual Exploitation
  - S5: Defamation
  - S6: Specialized Advice
  - S7: Privacy
  - S8: Intellectual Property
  - S9: Indiscriminate Weapons
  - S10: Hate
  - S11: Suicide & Self-Harm
  - S12: Sexual Content
  - S13: Elections
- **Use case**: Child accounts, family-safe environments
- **Blocks**: Everything including IP violations (S8)

## Database Configuration

Safety levels are stored in the `users` table:

```sql
-- User settings JSONB column
settings: {
  "safety_level": "standard"  -- or "strict", "permissive", "none"
}
```

## Request Flow

```
1. User Request → Dashboard
   ↓
2. Dashboard reads user.settings.safety_level from session
   ↓
3. Dashboard sends to AI Gateway with userSafetyLevel parameter
   ↓
4. AI Gateway checks if level is "none"/"disabled"/"off"
   ↓ YES → Skip all checks, generate image
   ↓ NO
5. AI Gateway calls Llama Guard 3 via AI Inferencing
   ↓
6. Llama Guard 3 checks content against user's safety categories
   ↓
7. If SAFE → Generate image
   If UNSAFE → Return violation details to user
```

## Implementation Details

### AI Gateway Handler
- Reads `userSafetyLevel` from request body (sent by Dashboard)
- Falls back to `safetyLevel` (legacy) or account-type defaults
- Checks for disabled values: `none`, `disabled`, `off`
- Calls Llama Guard 3 via AI Inferencing Service
- Checks both prompt and negative prompt

### AI Inferencing Service
- Hosts Llama Guard 3 via vLLM (local inference)
- Semantic Moderation Service maps safety levels to categories
- Returns: `{ safe: boolean, violations: [], reasoning: string }`

### ComfyUI Service
- **No safety filtering** - purely image generation
- All filtering happens upstream at AI Gateway

## Setting User Safety Levels

Administrators can set user safety levels via the database:

```sql
-- Set administrator with no filtering
UPDATE users 
SET settings = jsonb_set(settings, '{safety_level}', '"none"')
WHERE email = 'admin@example.com';

-- Set adult user to permissive
UPDATE users 
SET settings = jsonb_set(settings, '{safety_level}', '"permissive"')
WHERE id = 'user-id';

-- Set child account to strict
UPDATE users 
SET settings = jsonb_set(settings, '{safety_level}', '"strict"')
WHERE account_type = 'child';
```

## Benefits

1. **User-specific**: Each user has their own safety level
2. **Centralized**: Single point of control at AI Gateway
3. **Semantic**: Uses Llama Guard 3 for context-aware filtering
4. **Flexible**: Administrators can disable filtering entirely
5. **Transparent**: Users see which categories were violated
6. **Database-driven**: Easy to update via admin interface
