import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { 
  CurrencyDollarIcon, 
  UserGroupIcon, 
  CalendarIcon,
  QrCodeIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  EyeIcon
} from '@heroicons/react/24/outline';
import api from '../services/api';
import { getImageUrl } from '../utils/config';

interface SuperAdminPayment {
  _id: string;
  superSuperAdminId: {
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

interface QRCode {
  _id: string;
  qrImageUrl: string;
  qrImageName: string;
  description?: string;
}

const SuperAdminMyPayments: React.FC = () => {
  const [showProofModal, setShowProofModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<SuperAdminPayment | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [proofForm, setProofForm] = useState({
    proofType: 'screenshot',
    transactionNumber: '',
    paymentDate: '',
    amount: '',
    notes: ''
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const queryClient = useQueryClient();

  // Fetch super admin's payments
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ['super-admin-my-payments'],
    queryFn: async () => {
      const response = await api.get('/super-super-admin-payments/my-payments');
      return response.data;
    }
  });

  // Fetch QR code
  const { data: qrData, isLoading: qrLoading } = useQuery({
    queryKey: ['super-admin-payment-qr'],
    queryFn: async () => {
      const response = await api.get('/super-super-admin-payments/qr');
      return response.data;
    },
    retry: false
  });

  // Submit payment proof mutation
  const submitProofMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await api.post(`/super-super-admin-payments/${selectedPayment?._id}/proof`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Payment proof submitted successfully');
      setShowProofModal(false);
      setSelectedPayment(null);
      setProofForm({
        proofType: 'screenshot',
        transactionNumber: '',
        paymentDate: '',
        amount: '',
        notes: ''
      });
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['super-admin-my-payments'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to submit payment proof');
    }
  });

  const handleSubmitProof = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate based on proof type
    if (proofForm.proofType === 'screenshot' && !selectedFile) {
      toast.error('Please select a payment proof image');
      return;
    }
    
    if (proofForm.proofType === 'transaction' && !proofForm.transactionNumber.trim()) {
      toast.error('Please enter a transaction number');
      return;
    }

    const formData = new FormData();
    
    // Only append proof image if screenshot type is selected
    if (proofForm.proofType === 'screenshot' && selectedFile) {
      formData.append('proofImage', selectedFile);
    }
    
    formData.append('proofType', proofForm.proofType);
    formData.append('transactionNumber', proofForm.transactionNumber);
    formData.append('paymentDate', proofForm.paymentDate);
    formData.append('amount', proofForm.amount);
    formData.append('notes', proofForm.notes);

    submitProofMutation.mutate(formData);
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

  const getProofStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircleIcon className="w-4 h-4 mr-1" />
          Approved
        </span>;
      case 'rejected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <XCircleIcon className="w-4 h-4 mr-1" />
          Rejected
        </span>;
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <ClockIcon className="w-4 h-4 mr-1" />
          Pending
        </span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {status}
        </span>;
    }
  };

  const payments = paymentsData?.data || [];
  const qrCode = qrData?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Payments to SuperSuperAdmin</h1>
        <p className="text-gray-600">View and manage your payments to the super super admin</p>
      </div>

      {/* QR Code Section */}
      {!qrLoading && qrCode && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Payment QR Code</h2>
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0">
              <img
                src={getImageUrl(qrCode.qrImageUrl)}
                alt="Payment QR Code"
                className="w-32 h-32 object-contain border border-gray-200 rounded-lg shadow-sm"
                crossOrigin="anonymous"
              />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900">Scan to Pay</h3>
              <p className="text-sm text-gray-500 mt-1">
                Use this QR code to make payments to the super super admin
              </p>
              {qrCode.description && (
                <p className="text-sm text-gray-600 mt-2">{qrCode.description}</p>
              )}
              <button
                onClick={() => setShowQRModal(true)}
                className="mt-3 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <EyeIcon className="w-4 h-4 mr-2" />
                View Larger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payments Table */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b-2 border-gray-400">
          <h2 className="text-lg font-medium text-gray-900">Payment History</h2>
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Proof
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payments.map((payment: SuperAdminPayment) => (
                  <tr key={payment._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.paymentPeriod}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
  <UserGroupIcon className="w-4 h-4 text-gray-400" />

  {/* Total Users */}
  <span className="text-sm text-gray-900 font-medium">
    {payment.userCount}
  </span>

  {/* Deleted Users – always visible */}
  <span
    className={`text-sm ${
      payment.deletedUserCount > 0 ? 'text-red-500' : 'text-gray-400'
    }`}
  >
    ({payment.deletedUserCount ?? 0} deleted)
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      {payment.paymentProof ? (
                        getProofStatusBadge(payment.paymentProof.status)
                      ) : (
                        <span className="text-sm text-gray-500">No proof</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {payment.status === 'pending' && !payment.paymentProof && (
                        <button
                          onClick={() => {
                            setSelectedPayment(payment);
                            setShowProofModal(true);
                          }}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Submit Proof
                        </button>
                      )}
                      {payment.paymentProof && payment.paymentProof.status === 'rejected' && (
                        <button
                          onClick={() => {
                            setSelectedPayment(payment);
                            setShowProofModal(true);
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          Resubmit Proof
                        </button>
                      )}
                      {payment.paymentProof && payment.paymentProof.status !== 'rejected' && (
                        <button
                          onClick={() => {
                            setSelectedPayment(payment);
                            setShowProofModal(true);
                          }}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <CurrencyDollarIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No payments found</p>
            <p className="text-sm text-gray-400 mt-1">
              Payments will appear here once generated by the super super admin
            </p>
          </div>
        )}
      </div>

      {/* Payment Proof Modal */}
      {showProofModal && selectedPayment && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {selectedPayment.paymentProof && selectedPayment.paymentProof.status === 'rejected' 
                  ? 'Resubmit Payment Proof' 
                  : selectedPayment.paymentProof 
                    ? 'View Payment Proof' 
                    : 'Submit Payment Proof'
                }
              </h3>
              
                             {selectedPayment.paymentProof && selectedPayment.paymentProof.status !== 'rejected' ? (
                 // View existing proof (only for approved/pending proofs)
                 <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Proof Image</label>
                    <img
                      src={getImageUrl(selectedPayment.paymentProof.proofImageUrl)}
                      alt="Payment Proof"
                      className="mt-1 w-full h-48 object-contain border border-gray-300 rounded-md"
                      crossOrigin="anonymous"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Status</label>
                    <div className="mt-1">
                      {getProofStatusBadge(selectedPayment.paymentProof.status)}
                    </div>
                  </div>
                  {selectedPayment.paymentProof.transactionNumber && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Transaction Number</label>
                      <p className="mt-1 text-sm text-gray-900">{selectedPayment.paymentProof.transactionNumber}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Payment Date</label>
                    <p className="mt-1 text-sm text-gray-900">{formatDate(selectedPayment.paymentProof.paymentDate)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Amount</label>
                    <p className="mt-1 text-sm text-gray-900">₹{selectedPayment.paymentProof.amount}</p>
                  </div>
                  {selectedPayment.paymentProof.notes && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Notes</label>
                      <p className="mt-1 text-sm text-gray-900">{selectedPayment.paymentProof.notes}</p>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowProofModal(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                    >
                      Close
                    </button>
                  </div>
                </div>
                             ) : (
                 // Submit new proof or resubmit rejected proof
                 <form onSubmit={handleSubmitProof} className="space-y-4">
                   {/* Show rejected proof details at the top for resubmission */}
                   {selectedPayment.paymentProof && selectedPayment.paymentProof.status === 'rejected' && (
                     <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
                       <div className="flex">
                         <div className="flex-shrink-0">
                           <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                             <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                           </svg>
                         </div>
                         <div className="ml-3">
                           <h3 className="text-sm font-medium text-red-800">
                             Previous Payment Proof Rejected
                           </h3>
                           <div className="mt-2 text-sm text-red-700">
                             <p>Your previous payment proof was rejected. Please submit new proof with correct information.</p>
                           </div>
                         </div>
                       </div>
                     </div>
                   )}
                   
                   {/* Show previous rejected proof details */}
                   {selectedPayment.paymentProof && selectedPayment.paymentProof.status === 'rejected' && (
                     <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-4">
                       <h4 className="text-sm font-medium text-gray-800 mb-2">Previous Proof Details:</h4>
                       <div className="grid grid-cols-2 gap-2 text-sm">
                         <div>
                           <span className="text-gray-600">Payment Date:</span>
                           <span className="ml-1 text-gray-900">{formatDate(selectedPayment.paymentProof.paymentDate)}</span>
                         </div>
                         <div>
                           <span className="text-gray-600">Amount:</span>
                           <span className="ml-1 text-gray-900">₹{selectedPayment.paymentProof.amount}</span>
                         </div>
                         {selectedPayment.paymentProof.transactionNumber && (
                           <div className="col-span-2">
                             <span className="text-gray-600">Transaction Number:</span>
                             <span className="ml-1 text-gray-900">{selectedPayment.paymentProof.transactionNumber}</span>
                           </div>
                         )}
                         {selectedPayment.paymentProof.notes && (
                           <div className="col-span-2">
                             <span className="text-gray-600">Notes:</span>
                             <span className="ml-1 text-gray-900">{selectedPayment.paymentProof.notes}</span>
                           </div>
                         )}
                       </div>
                     </div>
                   )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Proof Type</label>
                    <select
                      value={proofForm.proofType}
                      onChange={(e) => {
                        setProofForm({ ...proofForm, proofType: e.target.value });
                        // Clear selected file when switching proof types
                        setSelectedFile(null);
                      }}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    >
                      <option value="screenshot">Screenshot</option>
                      <option value="transaction">Transaction Number</option>
                    </select>
                  </div>
                  {proofForm.proofType === 'screenshot' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Proof Image <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        required
                      />
                      <p className="mt-1 text-sm text-gray-500">Upload a screenshot of your payment confirmation</p>
                    </div>
                  )}
                  {proofForm.proofType === 'transaction' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Transaction Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={proofForm.transactionNumber}
                        onChange={(e) => setProofForm({ ...proofForm, transactionNumber: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Enter transaction number"
                        required
                      />
                      <p className="mt-1 text-sm text-gray-500">Enter the transaction number from your payment receipt</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Payment Date</label>
                    <input
                      type="date"
                      value={proofForm.paymentDate}
                      onChange={(e) => setProofForm({ ...proofForm, paymentDate: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Amount Paid (₹)</label>
                    <input
                      type="number"
                      value={proofForm.amount}
                      onChange={(e) => setProofForm({ ...proofForm, amount: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder={selectedPayment.totalAmount.toString()}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                    <textarea
                      value={proofForm.notes}
                      onChange={(e) => setProofForm({ ...proofForm, notes: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      rows={3}
                      placeholder="Any additional notes..."
                    />
                  </div>
                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setShowProofModal(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitProofMutation.isPending}
                      className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submitProofMutation.isPending 
                        ? 'Submitting...' 
                        : selectedPayment.paymentProof && (selectedPayment.paymentProof as any).status === 'rejected'
                          ? 'Resubmit Proof'
                          : 'Submit Proof'
                      }
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QR Code View Modal */}
      {showQRModal && qrCode && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Payment QR Code</h3>
                <button
                  onClick={() => setShowQRModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="flex justify-center">
                  <img
                    src={getImageUrl(qrCode.qrImageUrl)}
                    alt="Payment QR Code"
                    className="w-64 h-64 object-contain border border-gray-300 rounded-lg shadow-md"
                    crossOrigin="anonymous"
                  />
                </div>
                
                <div className="text-center">
                  <h4 className="text-sm font-medium text-gray-900">Scan to Pay</h4>
                  <p className="text-sm text-gray-500 mt-1">
                    Use this QR code to make payments to the super super admin
                  </p>
                  {qrCode.description && (
                    <p className="text-sm text-gray-600 mt-2">{qrCode.description}</p>
                  )}
                </div>
              </div>
              
              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setShowQRModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminMyPayments;
