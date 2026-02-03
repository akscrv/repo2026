# Google Cloud Storage Setup Guide

This guide will help you set up Google Cloud Storage (GCS) for storing Excel files, minimizing MongoDB storage usage.

## Prerequisites

- Google Cloud Platform (GCP) account
- Node.js installed
- Access to your project's `.env` file

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click **"New Project"**
4. Enter project name (e.g., "repo-app-storage")
5. Click **"Create"**
6. Wait for project creation, then select the new project

## Step 2: Enable Google Cloud Storage API

1. In the Google Cloud Console, go to **"APIs & Services" > "Library"**
2. Search for **"Cloud Storage API"**
3. Click on it and click **"Enable"**
4. Wait for the API to be enabled

## Step 3: Create Storage Bucket

1. Go to **"Cloud Storage" > "Buckets"** in the left sidebar
2. Click **"Create Bucket"**
3. Configure bucket:
   - **Name**: Choose a unique name (e.g., `repo-app-excel-files`)
   - **Location type**: Choose **"Region"** (select closest region to your users, e.g., `asia-south1` for India)
   - **Storage class**: **"Standard"** (for frequent access)
   - **Access control**: **"Uniform"** (recommended)
   - **Public access**: Choose based on your needs:
     - **"Enforce public access prevention"** (more secure, uses signed URLs)
     - **"Allow public access"** (simpler, but less secure)
4. Click **"Create"**

## Step 4: Create Service Account

1. Go to **"IAM & Admin" > "Service Accounts"**
2. Click **"Create Service Account"**
3. Enter details:
   - **Service account name**: `repo-app-storage`
   - **Service account ID**: Auto-generated
   - **Description**: "Service account for Excel file storage"
4. Click **"Create and Continue"**
5. Grant role: **"Storage Object Admin"** (allows read/write/delete)
6. Click **"Continue"** then **"Done"**

## Step 5: Create and Download JSON Key

1. Click on the service account you just created
2. Go to **"Keys"** tab
3. Click **"Add Key" > "Create new key"**
4. Select **"JSON"** format
5. Click **"Create"**
6. **IMPORTANT**: The JSON file will download automatically. Save it securely!

## Step 6: Configure Environment Variables

Add the following to your `.env` file:

```env
# Google Cloud Storage Configuration
GCS_PROJECT_ID=your-project-id-here
GCS_BUCKET_NAME=repo-app-excel-files
GCS_KEY_FILE=./config/gcs-key.json
GCS_PUBLIC_ACCESS=false
```

**Replace:**
- `your-project-id-here` with your GCP project ID (found in project settings)
- `repo-app-excel-files` with your bucket name
- Set `GCS_PUBLIC_ACCESS=true` if you enabled public access, `false` for signed URLs

## Step 7: Install Service Account Key File

1. Create a `config` directory in your project root:
   ```bash
   mkdir config
   ```

2. Copy the downloaded JSON key file to `config/gcs-key.json`:
   ```bash
   # On Linux/Mac
   cp ~/Downloads/your-project-*.json config/gcs-key.json
   
   # On Windows (PowerShell)
   Copy-Item ~/Downloads/your-project-*.json config/gcs-key.json
   ```

3. **IMPORTANT**: Add `config/` to `.gitignore` to prevent committing credentials:
   ```bash
   echo "config/" >> .gitignore
   ```

## Step 8: Install Dependencies

```bash
npm install @google-cloud/storage
```

## Step 9: Verify Setup

1. Start your server:
   ```bash
   npm start
   ```

2. Check server logs for:
   ```
   ✅ Google Cloud Storage initialized
   📦 Bucket: repo-app-excel-files
   ```

3. If you see errors, check:
   - JSON key file path is correct
   - Bucket name matches your bucket
   - Project ID is correct
   - Service account has Storage Object Admin role

## Step 10: Test Upload

1. Upload an Excel file through your application
2. Check Google Cloud Console > Cloud Storage > Buckets
3. You should see the uploaded file in the bucket

## Troubleshooting

### Error: "GCS bucket not initialized"
- Check that `GCS_BUCKET_NAME` is set correctly
- Verify the bucket exists in GCP Console
- Ensure service account has access to the bucket

### Error: "Could not load the default credentials"
- Verify `GCS_KEY_FILE` path is correct
- Check that the JSON key file exists
- Ensure the JSON file is valid

### Error: "Permission denied"
- Verify service account has **"Storage Object Admin"** role
- Check bucket permissions in GCP Console

### Error: "Bucket not found"
- Verify bucket name matches exactly (case-sensitive)
- Ensure bucket is in the same project as your service account

## Cost Estimation (India Region)

**Google Cloud Storage Pricing (as of 2024):**
- **Storage**: ₹0.20 per GB/month (Standard storage)
- **Operations**: 
  - Class A (uploads): ₹0.05 per 10,000 operations
  - Class B (downloads): ₹0.004 per 10,000 operations
- **Network egress**: First 1 GB free, then ₹0.12 per GB

**Example for 100GB:**
- Storage: 100 GB × ₹0.20 = **₹20/month**
- Operations: Minimal (depends on usage)
- **Total: ~₹20-25/month** for 100GB storage

**Comparison:**
- MongoDB Atlas 10GB: ~₹1,500-2,000/month
- GCS 100GB: ~₹20-25/month
- **Savings: 98%+**

## Security Best Practices

1. **Never commit** the JSON key file to Git
2. Use **signed URLs** instead of public access when possible
3. Set up **bucket lifecycle policies** to archive old files
4. Regularly **rotate service account keys**
5. Use **IAM conditions** to restrict access by IP if needed

## Next Steps

After setup, you can:
1. Migrate existing Excel files to GCS (see migration script)
2. Update your upload endpoints to use GCS
3. Monitor storage usage in GCP Console
4. Set up alerts for storage costs

## Support

If you encounter issues:
1. Check GCP Console for error details
2. Review server logs
3. Verify all environment variables are set
4. Test with a small file first
