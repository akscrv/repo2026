import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { 
  CurrencyDollarIcon, 
  UserGroupIcon, 
  CalendarIcon,
  CogIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import api from '../services/api';
import { getImageUrl } from '../utils/config';

interface AdminPaymentRate {
  _id: string;
  perUserRate: number;
  serviceRate: number;
  effectiveFrom: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
}

interface AdminPayment {
  _id: string;
  adminId: {
    _id: string;
    name: string;
    email: string;
    isDeleted?: boolean;
    deletedAt?: string;
  };
  superAdminId: {
    _id: string;
    name: string;
    email: string;
  };
  month: string;
  userCount: number;
  deletedUserCount?: number;
  perUserRate: number;
  serviceRate: number;
  isProrated: boolean;
  proratedDays?: number;
  totalDaysInMonth?: number;
  proratedServiceRate?: number;
  userAmount: number;
  totalAmount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  paymentDate?: string;
  paymentProof?: {
    _id: string;
    status: 'pending' | 'approved' | 'rejected';
    proofImageUrl: string;
    transactionNumber?: string;
    paymentDate: string;
    amount: number;
    notes?: string;
  };
  paymentPeriod: string;
  createdAt: string;
}

const AdminPaymentManagement: React.FC = () => {
  const [showRateModal, setShowRateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [rateForm, setRateForm] = useState({
    perUserRate: '',
    serviceRate: '',
    notes: ''
  });


  const queryClient = useQueryClient();

  // Fetch current rates
  const { data: ratesData, isLoading: ratesLoading } = useQuery({
    queryKey: ['admin-payment-rates'],
    queryFn: async () => {
      const response = await api.get('/admin-payments/rates');
      return response.data;
    }
  });

  // Fetch admin payments
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ['admin-payments', selectedMonth, selectedYear],
    queryFn: async () => {
      const monthParam = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`;
      const response = await api.get(`/admin-payments?month=${monthParam}`);
      return response.data;
    }
  });



  // Set rates mutation
  const setRatesMutation = useMutation({
    mutationFn: async (data: { perUserRate: number; serviceRate: number; notes?: string }) => {
      const response = await api.post('/admin-payments/rates', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Payment rates updated successfully');
      setShowRateModal(false);
      setRateForm({ perUserRate: '', serviceRate: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['admin-payment-rates'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update rates');
    }
  });

  // Generate payments mutation
  const generatePaymentsMutation = useMutation({
    mutationFn: async (month: string) => {
      const response = await api.post('/admin-payments/generate', { month });
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(data.message);
      setShowGenerateModal(false);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to generate payments');
    }
  });



  const handleSetRates = (e: React.FormEvent) => {
    e.preventDefault();
    setRatesMutation.mutate({
      perUserRate: parseFloat(rateForm.perUserRate),
      serviceRate: parseFloat(rateForm.serviceRate),
      notes: rateForm.notes
    });
  };

  const handleGeneratePayments = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRate) {
      toast.error('Please set payment rates first before generating payments');
      setShowGenerateModal(false);
      setShowRateModal(true);
      return;
    }
    const monthParam = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`;
    generatePaymentsMutation.mutate(monthParam);
  };



  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircleIcon className="w-4 h-4 mr-1" />
          Paid
        </span>;
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <ClockIcon className="w-4 h-4 mr-1" />
          Pending
        </span>;
      case 'overdue':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <XCircleIcon className="w-4 h-4 mr-1" />
          Overdue
        </span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {status}
        </span>;
    }
  };

  const currentRate = ratesData?.data;
  const payments = paymentsData?.data || [];

  // Calculate payment statistics
  const paymentStats = {
    expectedAmount: payments.reduce((sum, payment) => sum + payment.totalAmount, 0),
    paidAmount: payments.filter(p => p.status === 'paid').reduce((sum, payment) => sum + payment.totalAmount, 0),
    pendingAmount: payments.filter(p => p.status === 'pending').reduce((sum, payment) => sum + payment.totalAmount, 0),
    overdueAmount: payments.filter(p => p.status === 'overdue').reduce((sum, payment) => sum + payment.totalAmount, 0),
    totalAdmins: payments.length,
    paidAdmins: payments.filter(p => p.status === 'paid').length,
    pendingAdmins: payments.filter(p => p.status === 'pending').length,
    overdueAdmins: payments.filter(p => p.status === 'overdue').length
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Payment Management</h1>
          <p className="text-gray-600">Manage payment rates and admin payments</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowRateModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <CogIcon className="w-4 h-4 mr-2" />
            Set Rates
          </button>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
          >
            <DocumentTextIcon className="w-4 h-4 mr-2" />
            Generate Payments
          </button>
        </div>
      </div>

      {/* Month/Year Selector */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="h-5 w-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Period:</span>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
          className="form-select"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
            <option key={month} value={month}>
              {new Date(2024, month - 1).toLocaleDateString('en-US', { month: 'long' })}
            </option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          className="form-select"
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      {/* Payment Overview Cards */}
      <div className="mb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Payment amounts are calculated based on ALL users created during each month, including those who were added and deleted within the same month. 
            This ensures accurate billing for all user activity during the billing period.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Expected Amount */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <CurrencyDollarIcon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Expected Amount</p>
              <p className="text-2xl font-bold text-gray-900">₹{paymentStats.expectedAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-gray-500">Total Admins: {paymentStats.totalAdmins}</div>
          </div>
        </div>

        {/* Paid Amount */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircleIcon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Paid Amount</p>
              <p className="text-2xl font-bold text-green-600">₹{paymentStats.paidAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-gray-500">Paid Admins: {paymentStats.paidAdmins}</div>
          </div>
        </div>

        {/* Pending Amount */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                <ClockIcon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Pending Amount</p>
              <p className="text-2xl font-bold text-yellow-600">₹{paymentStats.pendingAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-gray-500">Pending Admins: {paymentStats.pendingAdmins}</div>
          </div>
        </div>

        {/* Overdue Amount */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                <XCircleIcon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Overdue Amount</p>
              <p className="text-2xl font-bold text-red-600">₹{paymentStats.overdueAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-gray-500">Overdue Admins: {paymentStats.overdueAdmins}</div>
          </div>
        </div>
      </div>

      {/* Current Rates Card */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Current Payment Rates</h2>
        {ratesLoading ? (
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          </div>
        ) : currentRate ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center">
                <UserGroupIcon className="w-5 h-5 text-blue-600 mr-2" />
                <span className="text-sm font-medium text-blue-900">Per User Rate</span>
              </div>
              <p className="text-2xl font-bold text-blue-600">₹{currentRate.perUserRate} / month</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center">
                <CurrencyDollarIcon className="w-5 h-5 text-green-600 mr-2" />
                <span className="text-sm font-medium text-green-900">Service Rate</span>
              </div>
              <p className="text-2xl font-bold text-green-600">₹{currentRate.serviceRate} / month</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <CurrencyDollarIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No payment rates set</p>
            <button
              onClick={() => setShowRateModal(true)}
              className="mt-2 text-indigo-600 hover:text-indigo-500"
            >
              Set rates now
            </button>
          </div>
                 )}
       </div>



       {/* Admin Payments Table */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b-2 border-gray-400">
          <h2 className="text-lg font-medium text-gray-900">Admin Payments</h2>
        </div>
        {paymentsLoading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Admin
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Period
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Users
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payments.map((payment: AdminPayment) => (
                  <tr key={payment._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className={`text-sm font-medium ${payment.adminId.isDeleted ? 'text-red-600' : 'text-gray-900'}`}>
                          {payment.adminId.name}
                          {payment.adminId.isDeleted && <span className="text-red-500"> (Deleted)</span>}
                        </div>
                        <div className={`text-sm ${payment.adminId.isDeleted ? 'text-red-400' : 'text-gray-500'}`}>
                          {payment.adminId.email}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.paymentPeriod}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <UserGroupIcon className="w-4 h-4 text-gray-400 mr-1" />
                        <span className="text-sm text-gray-900">
                          {payment.userCount}
                          {payment.deletedUserCount && payment.deletedUserCount > 0 && (
                            <span className="text-red-500"> ({payment.deletedUserCount} deleted)</span>
                          )}
                        </span>
                      </div>
                    </td>
                                         <td className="px-6 py-4 whitespace-nowrap">
                       <div className="text-sm text-gray-900">₹{payment.totalAmount}</div>
                       <div className="text-xs text-gray-500">
                         Users: ₹{payment.userAmount} + Service: ₹{payment.isProrated ? payment.proratedServiceRate : payment.serviceRate}
                         {payment.isProrated && (
                           <div className="text-xs text-orange-600">
                             Prorated ({payment.proratedDays}/{payment.totalDaysInMonth} days)
                           </div>
                         )}
                       </div>
                     </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(payment.dueDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(payment.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No admin payments found</p>
            <button
              onClick={() => setShowGenerateModal(true)}
              className="mt-2 text-indigo-600 hover:text-indigo-500"
            >
              Generate payments now
            </button>
          </div>
        )}
      </div>

      {/* Set Rates Modal */}
      {showRateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Set Payment Rates</h3>
              <form onSubmit={handleSetRates} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Per User Rate (₹)</label>
                  <input
                    type="number"
                    value={rateForm.perUserRate}
                    onChange={(e) => setRateForm({ ...rateForm, perUserRate: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Service Rate (₹)</label>
                  <input
                    type="number"
                    value={rateForm.serviceRate}
                    onChange={(e) => setRateForm({ ...rateForm, serviceRate: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="2000"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                  <textarea
                    value={rateForm.notes}
                    onChange={(e) => setRateForm({ ...rateForm, notes: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    rows={3}
                    placeholder="Any additional notes..."
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowRateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={setRatesMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {setRatesMutation.isPending ? 'Setting...' : 'Set Rates'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Generate Payments Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-6 border w-full max-w-2xl shadow-xl rounded-lg bg-white">
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Generate Admin Payments</h3>
              <form onSubmit={handleGeneratePayments} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Selected Period</label>
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg">
                    <p className="text-lg font-semibold text-gray-900">
                      {new Date(2024, selectedMonth - 1).toLocaleDateString('en-US', { month: 'long' })} {selectedYear}
                    </p>
                  </div>
                </div>

                {/* Current Rates Display */}
                {!currentRate ? (
                  <div className="bg-red-50 border-2 border-red-300 rounded-lg p-5">
                    <div className="flex items-start">
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-lg font-semibold text-red-800 mb-2">
                          ⚠️ Payment Rates Not Set
                        </h4>
                        <p className="text-sm text-red-700 mb-4">
                          You must set payment rates before generating payments. Payments cannot be generated without rates.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowGenerateModal(false);
                            setShowRateModal(true);
                          }}
                          className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-md"
                        >
                          Set Payment Rates Now
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-green-900 flex items-center">
                        <CurrencyDollarIcon className="h-5 w-5 mr-2" />
                        Current Payment Rates
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          setShowGenerateModal(false);
                          setShowRateModal(true);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-green-700 bg-white border-2 border-green-300 rounded-lg hover:bg-green-50 transition-colors"
                      >
                        Change Rates
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-4 rounded-lg border-2 border-blue-200 shadow-sm">
                        <div className="flex items-center mb-2">
                          <UserGroupIcon className="w-5 h-5 text-blue-600 mr-2" />
                          <span className="text-sm font-semibold text-blue-900">Per User Rate</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-600">₹{currentRate.perUserRate}</p>
                        <p className="text-xs text-gray-500 mt-1">per user / month</p>
                      </div>
                      <div className="bg-white p-4 rounded-lg border-2 border-green-200 shadow-sm">
                        <div className="flex items-center mb-2">
                          <CurrencyDollarIcon className="w-5 h-5 text-green-600 mr-2" />
                          <span className="text-sm font-semibold text-green-900">Service Rate</span>
                        </div>
                        <p className="text-2xl font-bold text-green-600">₹{currentRate.serviceRate}</p>
                        <p className="text-xs text-gray-500 mt-1">per admin / month</p>
                      </div>
                    </div>
                    {currentRate.notes && (
                      <div className="mt-4 p-3 bg-white rounded-lg border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 mb-1">Notes:</p>
                        <p className="text-sm text-gray-700">{currentRate.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> This will generate payments for all admins based on the number of users they created in the selected month.
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 border-2 border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generatePaymentsMutation.isPending || !currentRate}
                    className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 border border-transparent rounded-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
                  >
                    {generatePaymentsMutation.isPending ? 'Generating...' : 'Generate Payments'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}


     </div>
   );
 };

export default AdminPaymentManagement;
