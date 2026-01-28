import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import ExcelFiles from './pages/ExcelFiles'
import VehicleSearch from './pages/VehicleSearch'
import Profile from './pages/Profile'
import OTPManagement from './pages/OTPManagement'
import Notifications from './pages/Notifications'
import MoneyManagement from './pages/MoneyManagement'
import AdminPayments from './pages/AdminPayments'
import UserPayments from './pages/UserPayments'
import QRCodeManagement from './components/QRCodeManagement'
import PaymentSubmission from './components/PaymentSubmission'
import PaymentApproval from './components/PaymentApproval'
import AdminPaymentManagement from './components/AdminPaymentManagement'
import AdminMyPayments from './components/AdminMyPayments'
import SuperSuperAdminPaymentManagement from './components/SuperSuperAdminPaymentManagement'
import SuperAdminMyPayments from './components/SuperAdminMyPayments'
import AppManagement from './components/AppManagement'
import FileStorageHandling from './components/FileStorageHandling'
import StorageManagement from './pages/StorageManagement'
import BackOfficeNumbers from './pages/BackOfficeNumbers'
import Inventory from './pages/Inventory'
import Landing from './pages/Landing'

function AppContent() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/excel-files" element={<ExcelFiles />} />
        <Route path="/vehicle-search" element={<VehicleSearch />} />
        <Route path="/money" element={<MoneyManagement />} />
        <Route path="/admin-payments" element={<AdminPayments />} />
        <Route path="/user-payments" element={<UserPayments />} />
        <Route path="/qr-management" element={<QRCodeManagement />} />
        <Route path="/payment-submission" element={<PaymentSubmission />} />
        <Route path="/payment-approval" element={<PaymentApproval />} />
        <Route path="/admin-payment-management" element={<AdminPaymentManagement />} />
        <Route path="/admin-my-payments" element={<AdminMyPayments />} />
        <Route path="/super-super-admin-payments" element={<SuperSuperAdminPaymentManagement />} />
        <Route path="/super-admin-my-payments" element={<SuperAdminMyPayments />} />
        <Route path="/app-management" element={<AppManagement />} />
        <Route path="/file-storage-handling" element={<FileStorageHandling />} />
        <Route path="/storage-management" element={<StorageManagement />} />
        <Route path="/otp-management" element={<OTPManagement />} />
        <Route path="/notifications" element={<Notifications />} />
                          <Route path="/back-office-numbers" element={<BackOfficeNumbers />} />
                  <Route path="/inventory" element={<Inventory />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App 