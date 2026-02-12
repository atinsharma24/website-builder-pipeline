# CLI Tools

Administrative CLI scripts for managing website lifecycle data in Supabase. These scripts are located in `scripts/` and run via `ts-node` (not compiled by `tsc`).

> **Prerequisites**: These scripts require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file.

---

## Import Website Builder Published HTML

**Purpose**: Create a new site record in `website_builder_sites` or update an existing one, then upload the HTML to the `wb-site-published` storage bucket.

### Command

```bash
npm run wb:import-html -- [flags]
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--owner-user-id` | Yes | UUID of the site owner |
| `--business-name` | Yes (for new sites) | Business name for the site record |
| `--html-file` | Yes (or `--html-base64`) | Path to the HTML file to upload |
| `--html-base64` | Yes (or `--html-file`) | Base64-encoded HTML content |
| `--site-id` | No | UUID of an existing site to update |
| `--overwrite` | No | Allow overwriting an existing site (required with `--site-id`) |
| `--category` | No | Business category |
| `--tagline` | No | Business tagline |
| `--city` | No | City |
| `--state` | No | State |
| `--phone` | No | Phone number |
| `--help` | No | Display usage information |

### Examples

```bash
# Create a new site and upload HTML from a file
npm run wb:import-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --business-name "Sharma Optics" \
  --category "optical" \
  --city "Indore" \
  --state "Madhya Pradesh" \
  --html-file ./output/sharma-optics/run-123/index.html

# Update an existing site with new HTML
npm run wb:import-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --site-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --business-name "Sharma Optics" \
  --overwrite \
  --html-file ./updated-site.html

# Import HTML from Base64 (useful in CI/CD pipelines)
npm run wb:import-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --business-name "Acme Corp" \
  --html-base64 "PCFET0NUWVBFIGh0bWw+..."
```

---

## Override Website Builder HTML

**Purpose**: Force-update HTML for a specific site. Can target the published version in `wb-site-published`, create a snapshot revision in `wb-site-snapshots`, or both.

### Command

```bash
npm run wb:override-html -- [flags]
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--owner-user-id` | Yes | UUID of the site owner (used for ownership validation) |
| `--site-id` | Yes | UUID of the site to update |
| `--html-file` | Yes (or `--html-base64`) | Path to the HTML file |
| `--html-base64` | Yes (or `--html-file`) | Base64-encoded HTML content |
| `--target` | No | `published`, `snapshot`, or `both` (default: `published`) |
| `--snapshot-type` | No | Type label for the revision: `manual`, `auto`, or `override` (default: `override`) |
| `--help` | No | Display usage information |

### Examples

```bash
# Override published HTML only
npm run wb:override-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --site-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --target published \
  --html-file ./hotfix.html

# Create a snapshot revision without touching published
npm run wb:override-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --site-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --target snapshot \
  --snapshot-type manual \
  --html-file ./backup.html

# Override both published and create a snapshot
npm run wb:override-html -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --site-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --target both \
  --html-file ./redesign.html
```

---

## Purge Website Flow User

**Purpose**: **⚠️ DANGEROUS** — Delete all website data for a specific user. This includes site records, revisions, and files in all three storage buckets. Defaults to **dry-run mode** for safety.

### Command

```bash
npm run wb:purge-user -- [flags]
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--owner-user-id` | Yes | UUID of the user whose data to purge |
| `--dry-run` | No | Preview what would be deleted without actually deleting (this is the **default**) |
| `--execute` | No | Actually perform the deletion. **Irreversible.** |
| `--help` | No | Display usage information |

### Dry Run vs. Execute

By default, the script runs in **dry-run mode**. It will:
1. Look up all sites owned by the user
2. List all revisions associated with those sites
3. List all files in the three storage buckets
4. Print a comprehensive summary of what **would** be deleted
5. Exit without making any changes

Pass `--execute` to actually perform the deletion.

### Examples

```bash
# Preview what would be purged (safe — no changes made)
npm run wb:purge-user -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --dry-run

# Actually purge all data (⚠️ DESTRUCTIVE — cannot be undone)
npm run wb:purge-user -- \
  --owner-user-id "550e8400-e29b-41d4-a716-446655440000" \
  --execute
```

### What Gets Deleted

| Resource | Source |
|---|---|
| Site records | `website_builder_sites` rows where `owner_user_id` matches |
| Revision records | `website_builder_revisions` rows linked to the user's sites (via `ON DELETE CASCADE`) |
| Published files | `wb-site-published` bucket, paths under `{site_id}/` |
| Snapshot files | `wb-site-snapshots` bucket, paths under `{site_id}/` |
| Asset files | `wb-site-assets` bucket, paths under `{site_id}/` |

> **Note**: The script includes stubs for Daytona sandbox cleanup and payment system integration. These are marked as `TODO` for future implementation.
