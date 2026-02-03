# 📱 App Update System - How It Works

## 🔄 **How the App Checks for Updates**

### **1. Automatic Update Checking**

The app automatically checks for updates in multiple ways:

#### **A. On App Start**
- When the app launches, the `AppUpdateWidget` initializes
- It immediately checks the current installed version
- Then calls the backend API to get the latest available version

#### **B. When App Resumes**
- Uses `WidgetsBindingObserver` to detect when app comes to foreground
- Automatically checks for updates when user returns to the app
- Ensures users see updates even if they dismissed the banner earlier

#### **C. Periodic Checks**
- Checks every **30 minutes** automatically
- Runs in background while app is open
- Prevents excessive API calls (minimum 5 minutes between checks)

#### **D. Manual Refresh**
- Users can tap the refresh icon (🔄) on the update banner
- Forces an immediate check for updates

---

## 🌐 **Backend API Endpoint**

### **Public Endpoint (No Authentication Required)**
```
GET /api/app-management/public/versions
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "app_version_id",
      "appType": "main",
      "version": "1.0.1",
      "versionCode": 2,
      "fileName": "main-app-v1.0.1-1234567890.apk",
      "filePath": "/uploads/apps/main-app-v1.0.1-1234567890.apk",
      "description": "Bug fixes and performance improvements",
      "features": ["Offline search", "Payment management"],
      "isActive": true,
      "downloadCount": 0,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### **Download Endpoint**
```
GET /api/app-management/download/:id
```
- Downloads the APK file directly
- No authentication required (public endpoint)
- Increments download count automatically

---

## 🔍 **Version Comparison Logic**

### **How It Determines If Update Is Available:**

1. **Gets Current Version:**
   - Uses `package_info_plus` to read `pubspec.yaml` version
   - Extracts `version` (e.g., "1.0.0") and `buildNumber` (e.g., "1")
   - `buildNumber` becomes `versionCode` for comparison

2. **Gets Server Version:**
   - Calls `/api/app-management/public/versions`
   - Finds the active "main" app version
   - Extracts `versionCode` from response

3. **Compares Version Codes:**
   ```dart
   if (serverVersionCode > currentVersionCode) {
     // Show update banner
   }
   ```

4. **Shows Update Banner:**
   - Displays orange banner at top of dashboard
   - Shows current vs new version
   - Shows "What's New" description
   - Shows feature list
   - Provides "Update Now" button

---

## 📥 **Download & Installation Flow**

### **When User Taps "Update Now":**

1. **Download APK:**
   - Shows loading dialog
   - Downloads APK from: `http://YOUR_SERVER/app-management/download/:id`
   - Saves to device: `/data/data/com.example.repotrack/app_flutter/app-update.apk`

2. **Open APK:**
   - Uses `url_launcher` to open the APK file
   - Android automatically prompts: "Do you want to install this application?"
   - User taps "Install"

3. **Automatic Update:**
   - Android detects same package name + higher version code
   - **Automatically updates** the app (no uninstall needed)
   - All user data is preserved
   - App restarts with new version

---

## 🔧 **Configuration**

### **Backend Setup:**

1. **Upload New Version:**
   - Login as SuperSuperAdmin
   - Go to App Management page
   - Click "Upload New App"
   - Fill form:
     - App Type: `main` or `emergency`
     - Version: `1.0.1` (user-visible version)
     - Version Code: `2` (must be higher than previous)
     - Description: What's new
     - Features: Comma-separated list
   - Upload APK file
   - Backend automatically:
     - Deactivates old version
     - Sets new version as active
     - Stores file in `uploads/apps/`

### **Frontend (Flutter App) Setup:**

1. **Update Version in `pubspec.yaml`:**
   ```yaml
   version: 1.0.1+2  # Format: version+buildNumber
   ```
   - `1.0.1` = version (shown to users)
   - `2` = buildNumber (becomes versionCode)

2. **Build APK:**
   ```bash
   flutter build apk --release
   ```

3. **Upload via Frontend:**
   - Use the App Management page to upload

---

## 📊 **Update Check Flow Diagram**

```
App Starts
    ↓
Get Current Version (from device)
    ↓
Call Backend API: /api/app-management/public/versions
    ↓
Compare versionCode: Server vs Current
    ↓
Server > Current?
    ├─ YES → Show Update Banner
    └─ NO → Hide Banner
    ↓
User Taps "Update Now"
    ↓
Download APK from Server
    ↓
Save to Device Storage
    ↓
Open APK File
    ↓
Android Install Prompt
    ↓
User Confirms Install
    ↓
Android Updates App Automatically
    ↓
App Restarts with New Version
```

---

## 🛡️ **Error Handling**

### **If Backend is Unavailable:**
- App continues to work normally
- No update banner shown
- Error logged but not shown to user
- Next check will retry automatically

### **If Download Fails:**
- Shows error message to user
- User can retry by tapping "Update Now" again
- APK file is not corrupted (partial downloads are discarded)

### **If Installation Fails:**
- Android handles this automatically
- User can manually install from file location
- App shows file path in error message

---

## 🔐 **Security**

- **Public Endpoint:** `/api/app-management/public/versions` is public (no auth)
  - Safe because it only returns version info, not sensitive data
  - Allows app to check for updates without login

- **Download Endpoint:** `/api/app-management/download/:id` is public
  - Safe because APK files are meant to be downloadable
  - Download count is tracked for analytics

- **Upload Endpoint:** `/api/app-management/upload` requires SuperSuperAdmin
  - Only authorized users can upload new versions
  - Validates file type (APK only)
  - Validates file size (max 100MB)

---

## 📝 **Testing the Update System**

### **Test Scenario:**

1. **Build Version 1:**
   ```yaml
   version: 1.0.0+1
   ```
   ```bash
   flutter build apk --release
   ```
   - Install on device

2. **Upload Version 1:**
   - Upload via frontend with version `1.0.0` and versionCode `1`

3. **Build Version 2:**
   ```yaml
   version: 1.0.1+2
   ```
   ```bash
   flutter build apk --release
   ```

4. **Upload Version 2:**
   - Upload via frontend with version `1.0.1` and versionCode `2`

5. **Test Update:**
   - Open app with Version 1 installed
   - Should see update banner
   - Tap "Update Now"
   - Should download and install Version 2
   - App should restart with Version 2

---

## ✅ **Summary**

**The app knows about new versions because:**
1. ✅ It calls the backend API automatically (on start, resume, periodically)
2. ✅ Backend returns the latest active version
3. ✅ App compares version codes
4. ✅ Shows update banner if newer version exists
5. ✅ User can download and install with one tap
6. ✅ Android automatically updates (no uninstall needed)

**No manual intervention needed** - the system works automatically! 🎉
