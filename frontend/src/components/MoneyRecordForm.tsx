import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { moneyAPI, excelAPI, usersAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import {
  XMarkIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TruckIcon,
  CurrencyDollarIcon,
  BuildingLibraryIcon,
  CalendarIcon,
  UserIcon
} from '@heroicons/react/24/outline';

interface MoneyRecord {
  _id: string;
  registration_number: string;
  bill_date: string;
  bank: string;
  make: string;
  model: string;
  status: string;
  yard_name: string;
  repo_bill_amount: number;
  repo_payment_status: string;
  total_bill_amount: number;
  loan_number: string;
  customer_name: string;
  load: string;
  load_details: string;
  confirmed_by: string;
  repo_date: string;
  service_tax: number;
  payment_to_repo_team: number;
  field_agent?: string;
}

interface MoneyRecordFormProps {
  record?: MoneyRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormData {
  registration_number: string;
  bill_date: string;
  bank: string;
  make: string;
  model: string;
  status: string;
  yard_name: string;
  repo_bill_amount: number;
  repo_payment_status: string;
  total_bill_amount: number;
  loan_number: string;
  customer_name: string;
  load: string;
  load_details: string;
  confirmed_by: string;
  repo_date: string;
  service_tax: number;
  payment_to_repo_team: number;
  field_agent?: string;
}

export default function MoneyRecordForm({ record, onClose, onSuccess }: MoneyRecordFormProps) {
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [vehicleFound, setVehicleFound] = useState<boolean | null>(null);
  const [hasLookedUp, setHasLookedUp] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [regSearchTerm, setRegSearchTerm] = useState('');

  const { register, handleSubmit, formState: { errors }, setValue, watch, reset } = useForm<FormData>({
    defaultValues: record ? {
      ...record,
      bill_date: record.bill_date.split('T')[0],
      repo_date: record.repo_date.split('T')[0]
    } : {
      registration_number: '',
      bill_date: '',
      bank: '',
      make: '',
      model: '',
      status: '',
      yard_name: '',
      repo_bill_amount: 0,
      repo_payment_status: 'Payment Due',
      total_bill_amount: 0,
      loan_number: '',
      customer_name: '',
      load: '',
      load_details: '',
      confirmed_by: '',
      repo_date: '',
      service_tax: 0,
      payment_to_repo_team: 0,
      field_agent: ''
    }
  });

  const registrationNumber = watch('registration_number');

  // Vehicle search suggestions
  const { data: vehicleSuggestions } = useQuery({
    queryKey: ['vehicle-suggestions', regSearchTerm],
    queryFn: () => excelAPI.searchVehicles({
      search: regSearchTerm,
      searchType: 'registration_number',
      limit: 10
    }),
    enabled: regSearchTerm.length >= 3,
    staleTime: 30000
  });

  // Fetch field agents for dropdown
  const { data: fieldAgentsData } = useQuery({
    queryKey: ['field-agents'],
    queryFn: () => usersAPI.getAll({ role: 'fieldAgent', limit: 100 }),
    staleTime: 300000 // 5 minutes
  });

  const fieldAgents = fieldAgentsData?.data?.data || [];

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: (data: FormData) => {
      if (record) {
        return moneyAPI.update(record._id, data);
      } else {
        return moneyAPI.create(data);
      }
    },
    onSuccess: () => {
      toast.success(record ? 'Record updated successfully' : 'Record created successfully');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save record');
    }
  });

  // Vehicle lookup mutation
  const lookupMutation = useMutation({
    mutationFn: (regNumber: string) => moneyAPI.getVehicleByReg(regNumber),
    onSuccess: (response) => {
      setIsLookingUp(false);
      setHasLookedUp(true);
      
      if (response.data.found) {
        const vehicleData = response.data.data;
        setVehicleFound(true);
        
        // Pre-fill form with vehicle data (only if fields are empty)
        if (!watch('make')) setValue('make', vehicleData.make || '');
        if (!watch('model')) setValue('model', vehicleData.model || '');
        if (!watch('bank')) setValue('bank', vehicleData.bank || '');
        if (!watch('customer_name')) setValue('customer_name', vehicleData.customer_name || '');
        if (!watch('loan_number')) setValue('loan_number', vehicleData.loan_number || '');
        if (!watch('status')) setValue('status', vehicleData.status || '');
        
        toast.success('Vehicle data found and pre-filled');
      } else {
        setVehicleFound(false);
        toast.info('Vehicle not found in master data. Please enter details manually.');
      }
    },
    onError: (error: any) => {
      setIsLookingUp(false);
      setHasLookedUp(true);
      setVehicleFound(false);
      toast.error('Failed to lookup vehicle data');
    }
  });

  // Handle registration number selection from dropdown
  const handleRegistrationSelect = async (vehicleData: any) => {
    // Phase 1 search returns minimal data, so we need to fetch full details
    if (vehicleData.detailsAvailable && vehicleData._id) {
      // Fetch full details using Phase 2 endpoint
      try {
        const detailsResponse = await excelAPI.getVehicleDetails(vehicleData._id);
        const fullVehicleData = detailsResponse.data.data;
        
        setValue('registration_number', fullVehicleData.registration_number || vehicleData.registration_number);
        setValue('make', fullVehicleData.make || '');
        setValue('model', fullVehicleData.model || '');
        setValue('bank', fullVehicleData.bank || '');
        setValue('customer_name', fullVehicleData.customer_name || '');
        setValue('loan_number', fullVehicleData.loan_number || '');
        setValue('status', fullVehicleData.status || '');
        
        setShowSuggestions(false);
        setVehicleFound(true);
        setHasLookedUp(true);
        setRegSearchTerm('');
        
        toast.success('Vehicle data filled automatically');
      } catch (error) {
        // Fallback to minimal data if details fetch fails
        setValue('registration_number', vehicleData.registration_number);
        setShowSuggestions(false);
        setVehicleFound(null);
        toast.info('Registration number set. Please enter other details manually or use lookup button.');
      }
    } else {
      // Fallback: Use available data (for backward compatibility)
      setValue('registration_number', vehicleData.registration_number);
      setValue('make', vehicleData.make || '');
      setValue('model', vehicleData.model || '');
      setValue('bank', vehicleData.bank || '');
      setValue('customer_name', vehicleData.customer_name || '');
      setValue('loan_number', vehicleData.loan_number || '');
      setValue('status', vehicleData.status || '');
      
      setShowSuggestions(false);
      setVehicleFound(true);
      setHasLookedUp(true);
      setRegSearchTerm('');
      
      toast.success('Vehicle data filled automatically');
    }
  };

  // Handle registration input change
  const handleRegistrationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setRegSearchTerm(value);
    setShowSuggestions(value.length >= 3);
    setHasLookedUp(false);
    setVehicleFound(null);
    return value; // Return for react-hook-form
  };

  // Auto-lookup when registration number is entered (on blur)
  const handleRegistrationBlur = () => {
    setTimeout(() => setShowSuggestions(false), 200); // Delay to allow click on suggestion
  };

  const onSubmit = (data: FormData) => {
    saveMutation.mutate({
      ...data,
      registration_number: data.registration_number.toUpperCase().trim(),
      repo_bill_amount: Number(data.repo_bill_amount),
      total_bill_amount: Number(data.total_bill_amount),
      service_tax: Number(data.service_tax),
      payment_to_repo_team: Number(data.payment_to_repo_team)
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '95vw', width: '95vw', maxHeight: '95vh', overflowY: 'auto', padding: '0' }}>
        <div className="modal-content w-full" style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div className="modal-header bg-gradient-to-r from-blue-50 to-indigo-50 border-b-2 border-blue-200 px-8 py-5">
            <h2 className="text-2xl font-bold text-[var(--brand-navy)]">
              {record ? 'Edit Money Record' : 'Add New Money Record'}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 hover:bg-white rounded-full p-1 transition-colors">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="modal-body px-8 py-8 bg-gray-50">
            {/* Vehicle Information Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="flex items-center mb-6 pb-3 border-b-2 border-blue-100">
                <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg mr-3">
                  <TruckIcon className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-[var(--brand-navy)]">Vehicle Information</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="md:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Registration Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      {...register('registration_number', { 
                        required: 'Registration number is required',
                        minLength: { value: 6, message: 'Registration number must be at least 6 characters' }
                      })}
                      onChange={(e) => {
                        handleRegistrationChange(e);
                        // Also update the form value
                        setValue('registration_number', e.target.value.toUpperCase());
                      }}
                      onBlur={handleRegistrationBlur}
                      onFocus={() => registrationNumber && registrationNumber.length >= 3 && setShowSuggestions(true)}
                      className="form-input pr-12 h-12 text-lg font-mono border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg transition-all"
                      placeholder="e.g., BR01FY9181 (type to search suggestions)"
                      style={{ textTransform: 'uppercase' }}
                      autoComplete="off"
                    />
                    
                    {/* Lookup status indicator */}
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                      {regSearchTerm.length >= 3 ? (
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                          <MagnifyingGlassIcon className="h-5 w-5 text-blue-500" />
                        </div>
                      ) : vehicleFound === true ? (
                        <div className="flex items-center space-x-1 bg-green-100 px-2 py-1 rounded">
                          <CheckCircleIcon className="h-5 w-5 text-green-600" title="Vehicle data auto-filled" />
                        </div>
                      ) : vehicleFound === false ? (
                        <div className="flex items-center space-x-1 bg-yellow-100 px-2 py-1 rounded">
                          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" title="No vehicle found" />
                        </div>
                      ) : null}
                    </div>

                    {/* Suggestions dropdown */}
                    {showSuggestions && vehicleSuggestions?.data?.data?.length > 0 && (
                      <div className="absolute z-50 w-full mt-2 bg-white border-2 border-blue-400 rounded-lg shadow-2xl max-h-80 overflow-y-auto">
                        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-b-2 border-blue-600 px-4 py-3 z-10">
                          <div className="text-sm font-bold flex items-center">
                            <MagnifyingGlassIcon className="h-4 w-4 mr-2" />
                            {vehicleSuggestions.data.data.length} vehicle{vehicleSuggestions.data.data.length !== 1 ? 's' : ''} found
                          </div>
                        </div>
                        {vehicleSuggestions.data.data.map((vehicle: any, index: number) => (
                          <div
                            key={vehicle._id}
                            onClick={() => handleRegistrationSelect(vehicle)}
                            className={`px-6 py-5 hover:bg-blue-100 cursor-pointer transition-all duration-200 border-b-2 border-gray-200 last:border-b-0 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-blue-50'
                            }`}
                          >
                            <div className="space-y-4">
                              {/* Registration Number Row - Clear separation */}
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-2xl text-blue-700 font-mono mb-2 break-words">
                                    {vehicle.registration_number}
                                  </div>
                                </div>
                                {vehicle.detailsAvailable && (
                                  <div className="flex-shrink-0">
                                    <span className="inline-block text-xs bg-green-500 text-white px-3 py-2 rounded-lg font-bold shadow-sm">
                                      ✓ Full Details
                                    </span>
                                  </div>
                                )}
                              </div>
                              
                              {/* Vehicle Details - Better spacing */}
                              <div className="space-y-2.5 pl-1">
                                {vehicle.chasis_number && (
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-gray-700 w-32 flex-shrink-0 text-sm">Chassis:</span>
                                    <span className="font-mono text-gray-900 text-base break-all font-semibold">{vehicle.chasis_number}</span>
                                  </div>
                                )}
                                {vehicle.dataType && (
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-gray-700 w-32 flex-shrink-0 text-sm">Data Type:</span>
                                    <span className="text-purple-700 font-bold text-base">{vehicle.dataType}</span>
                                  </div>
                                )}
                                {(vehicle.make || vehicle.model) && (
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-gray-700 w-32 flex-shrink-0 text-sm">Vehicle:</span>
                                    <span className="text-gray-900 font-semibold text-base">{vehicle.make} {vehicle.model}</span>
                                  </div>
                                )}
                                {vehicle.bank && (
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-gray-700 w-32 flex-shrink-0 text-sm">Bank:</span>
                                    <span className="text-gray-900 font-semibold text-base break-words">{vehicle.bank}</span>
                                  </div>
                                )}
                                {vehicle.customer_name && (
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-gray-700 w-32 flex-shrink-0 text-sm">Customer:</span>
                                    <span className="text-gray-900 font-semibold text-base break-words">{vehicle.customer_name}</span>
                                  </div>
                                )}
                              </div>
                              
                              {/* Select Button - Clear call to action */}
                              <div className="flex justify-end pt-3 border-t-2 border-blue-200 mt-4">
                                <button
                                  type="button"
                                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-base font-bold px-8 py-3 rounded-lg shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 transform hover:scale-105"
                                >
                                  Select This Vehicle →
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                  

                    {/* No suggestions message */}
                    {showSuggestions && regSearchTerm.length >= 3 && 
                     vehicleSuggestions?.data?.data && vehicleSuggestions.data.data.length === 0 && (
                      <div className="absolute z-50 w-full mt-2 bg-white border-2 border-yellow-300 rounded-lg shadow-xl p-6 text-center">
                        <div className="flex flex-col items-center">
                          <ExclamationTriangleIcon className="h-8 w-8 text-yellow-500 mb-3" />
                          <div className="text-base font-semibold text-gray-700 mb-1">No vehicles found</div>
                          <div className="text-sm text-gray-600">No vehicles matching "{regSearchTerm}"</div>
                          <div className="text-xs text-gray-500 mt-2">You can still enter the registration number manually</div>
                        </div>
                      </div>
                    )}
                  </div>
                  {errors.registration_number && (
                    <p className="mt-2 text-sm text-red-600 font-medium flex items-center">
                      <ExclamationTriangleIcon className="h-4 w-4 mr-1" />
                      {errors.registration_number.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Make <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('make', { required: 'Make is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg transition-all"
                    placeholder="e.g., Hero"
                  />
                  {errors.make && <p className="mt-1 text-sm text-red-600 font-medium">{errors.make.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Model <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('model', { required: 'Model is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg transition-all"
                    placeholder="e.g., Splendor Plus"
                  />
                  {errors.model && <p className="mt-1 text-sm text-red-600 font-medium">{errors.model.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Bank <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('bank', { required: 'Bank is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg transition-all"
                    placeholder="e.g., HDFC Bank"
                  />
                  {errors.bank && <p className="mt-1 text-sm text-red-600 font-medium">{errors.bank.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    {...register('status', { required: 'Status is required' })}
                    className="form-select h-11 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg transition-all"
                  >
                    <option value="">Select Status</option>
                    <option value=".ON YARD">ON YARD</option>
                    <option value="RELEASE">RELEASE</option>
                    <option value="PENDING">PENDING</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="IN TRANSIT">IN TRANSIT</option>
                  </select>
                  {errors.status && <p className="mt-1 text-sm text-red-600 font-medium">{errors.status.message}</p>}
                </div>
              </div>
            </div>

            {/* Billing Information Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="flex items-center mb-6 pb-3 border-b-2 border-green-100">
                <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-lg mr-3">
                  <CurrencyDollarIcon className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-[var(--brand-navy)]">Billing Information</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Bill Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('bill_date', { required: 'Bill date is required' })}
                    type="date"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all"
                  />
                  {errors.bill_date && <p className="mt-1 text-sm text-red-600 font-medium">{errors.bill_date.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Repo Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('repo_date', { required: 'Repo date is required' })}
                    type="date"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all"
                  />
                  {errors.repo_date && <p className="mt-1 text-sm text-red-600 font-medium">{errors.repo_date.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Yard Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('yard_name', { required: 'Yard name is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all"
                    placeholder="e.g., ABC Recovery Yard"
                  />
                  {errors.yard_name && <p className="mt-1 text-sm text-red-600 font-medium">{errors.yard_name.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Repo Payment Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    {...register('repo_payment_status', { required: 'Payment status is required' })}
                    className="form-select h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all"
                  >
                    <option value="Payment Due">Payment Due</option>
                    <option value="Done">Done</option>
                    <option value="Partial">Partial</option>
                    <option value="Processing">Processing</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  {errors.repo_payment_status && <p className="mt-1 text-sm text-red-600 font-medium">{errors.repo_payment_status.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Repo Bill Amount <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('repo_bill_amount', { 
                      required: 'Repo bill amount is required',
                      min: { value: 0, message: 'Amount cannot be negative' }
                    })}
                    type="number"
                    step="0.01"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all font-mono"
                    placeholder="0.00"
                  />
                  {errors.repo_bill_amount && <p className="mt-1 text-sm text-red-600 font-medium">{errors.repo_bill_amount.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Total Bill Amount <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('total_bill_amount', { 
                      required: 'Total bill amount is required',
                      min: { value: 0, message: 'Amount cannot be negative' }
                    })}
                    type="number"
                    step="0.01"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all font-mono"
                    placeholder="0.00"
                  />
                  {errors.total_bill_amount && <p className="mt-1 text-sm text-red-600 font-medium">{errors.total_bill_amount.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Service Tax</label>
                  <input
                    {...register('service_tax', { 
                      min: { value: 0, message: 'Amount cannot be negative' }
                    })}
                    type="number"
                    step="0.01"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all font-mono"
                    placeholder="0.00"
                  />
                  {errors.service_tax && <p className="mt-1 text-sm text-red-600 font-medium">{errors.service_tax.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Payment to Repo Team</label>
                  <input
                    {...register('payment_to_repo_team', { 
                      min: { value: 0, message: 'Amount cannot be negative' }
                    })}
                    type="number"
                    step="0.01"
                    className="form-input h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all font-mono"
                    placeholder="0.00"
                  />
                  {errors.payment_to_repo_team && <p className="mt-1 text-sm text-red-600 font-medium">{errors.payment_to_repo_team.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Field Agent</label>
                  <select
                    {...register('field_agent')}
                    className="form-select h-11 border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 rounded-lg transition-all"
                  >
                    <option value="">Select Field Agent</option>
                    {fieldAgents.map((agent: any) => (
                      <option key={agent._id} value={agent._id}>
                        {agent.name} - {agent.phone}
                      </option>
                    ))}
                  </select>
                  {errors.field_agent && <p className="mt-1 text-sm text-red-600 font-medium">{errors.field_agent.message}</p>}
                </div>
              </div>
            </div>

            {/* Customer & Loan Information Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="flex items-center mb-6 pb-3 border-b-2 border-purple-100">
                <div className="flex items-center justify-center w-10 h-10 bg-purple-100 rounded-lg mr-3">
                  <UserIcon className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="text-xl font-bold text-[var(--brand-navy)]">Customer & Loan Information</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Customer Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('customer_name', { required: 'Customer name is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-lg transition-all"
                    placeholder="e.g., Raj Kumar"
                  />
                  {errors.customer_name && <p className="mt-1 text-sm text-red-600 font-medium">{errors.customer_name.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Loan Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('loan_number', { required: 'Loan number is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-lg transition-all font-mono"
                    placeholder="e.g., LN123456789"
                  />
                  {errors.loan_number && <p className="mt-1 text-sm text-red-600 font-medium">{errors.loan_number.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Confirmed By <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('confirmed_by', { required: 'Confirmed by is required' })}
                    className="form-input h-11 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-lg transition-all"
                    placeholder="e.g., Sandeep Kumar"
                  />
                  {errors.confirmed_by && <p className="mt-1 text-sm text-red-600 font-medium">{errors.confirmed_by.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Load</label>
                  <input
                    {...register('load')}
                    className="form-input h-11 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-lg transition-all"
                    placeholder="Optional load information"
                  />
                </div>

                <div className="md:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Load Details</label>
                  <textarea
                    {...register('load_details')}
                    rows={4}
                    className="form-input border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-lg transition-all resize-none"
                    placeholder="Additional load details (optional)"
                  />
                </div>
              </div>
            </div>
          </form>

          <div className="modal-footer bg-gradient-to-r from-gray-50 to-blue-50 border-t-2 border-gray-200 px-8 py-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saveMutation.isPending}
              className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit(onSubmit)}
              disabled={saveMutation.isPending}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {saveMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  {record ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                <>
                  {record ? 'Update Record' : 'Create Record'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
