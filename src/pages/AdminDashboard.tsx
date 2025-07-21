import React, { useState } from 'react';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useBooking } from '../contexts/BookingContext';
import { Navigate } from 'react-router-dom';
import { 
  Calendar, 
  Users, 
  DollarSign, 
  Settings, 
  CheckCircle, 
  XCircle,
  Edit,
  Trash2,
  Phone,
  Mail,
  MessageCircle
} from 'lucide-react';

interface Booking {
  id: string;
  workspace_type: string;
  date: string;
  time_slot: string;
  duration: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_whatsapp: string;
  total_price: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  confirmation_code: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const { sendWebhook } = useBooking();
  const [activeTab, setActiveTab] = useState('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalBookings: 0,
    activeMembers: 0,
    monthlyRevenue: 0,
    pendingBookings: 0
  });

  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  useEffect(() => {
    fetchBookings();
    fetchStats();
    
    // Set up real-time subscription for bookings
    const bookingsSubscription = supabase
      .channel('bookings_changes')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'bookings' 
        }, 
        (payload) => {
          console.log('New booking received:', payload.new);
          setBookings(prev => [payload.new as Booking, ...prev]);
          fetchStats(); // Refresh stats when new booking arrives
        }
      )
      .on('postgres_changes', 
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'bookings' 
        }, 
        (payload) => {
          console.log('Booking updated:', payload.new);
          setBookings(prev => 
            prev.map(booking => 
              booking.id === payload.new.id ? payload.new as Booking : booking
            )
          );
          fetchStats(); // Refresh stats when booking is updated
        }
      )
      .subscribe();

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(bookingsSubscription);
    };
  }, []);

  const fetchBookings = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBookings(data || []);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data: bookingsData, error } = await supabase
        .from('bookings')
        .select('status, total_price, created_at');

      if (error) throw error;

      const totalBookings = bookingsData?.length || 0;
      const pendingBookings = bookingsData?.filter(b => b.status === 'pending').length || 0;
      const monthlyRevenue = bookingsData
        ?.filter(b => b.status === 'confirmed')
        .reduce((sum, b) => sum + (b.total_price || 0), 0) || 0;

      setStats({
        totalBookings,
        activeMembers: Math.floor(totalBookings * 0.7), // Mock calculation
        monthlyRevenue,
        pendingBookings
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleConfirmBooking = async (bookingId: string) => {
    try {
      // Generate confirmation code
      const confirmationCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Get booking data for webhook
      const { data: bookingData, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (fetchError) throw fetchError;

      // Update booking status to 'code_sent' and store confirmation code
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ 
          status: 'code_sent',
          confirmation_code: confirmationCode,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (updateError) throw updateError;

      // Send webhook notification with confirmation code
      try {
        await fetch('https://aibackend.cp-devcode.com/webhook/1ef572d1-3263-4784-bc19-c38b3fbc09d0', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'send_confirmation_code',
            bookingId: bookingId,
            confirmationCode: confirmationCode,
            customerData: {
              name: bookingData.customer_name,
              whatsapp: bookingData.customer_whatsapp,
              email: bookingData.customer_email,
              phone: bookingData.customer_phone
            },
            bookingDetails: {
              workspace_type: bookingData.workspace_type,
              date: bookingData.date,
              time_slot: bookingData.time_slot,
              duration: bookingData.duration,
              total_price: bookingData.total_price
            },
            timestamp: new Date().toISOString()
          })
        });
      } catch (webhookError) {
        console.error('Webhook failed:', webhookError);
        // Don't fail the confirmation if webhook fails
      }
      
      // Note: Real-time subscription will automatically update the UI
      
      alert(`Confirmation code ${confirmationCode} sent to customer via WhatsApp!`);
    } catch (error) {
      console.error('Error confirming booking:', error);
      alert('Failed to send confirmation code. Please try again.');
    }
  };

  const handleRejectBooking = async (bookingId: string) => {
    if (confirm('Are you sure you want to reject this booking?')) {
      try {
        const { error } = await supabase
          .from('bookings')
          .update({ status: 'rejected' })
          .eq('id', bookingId);

        if (error) throw error;

        // Send webhook notification for rejection
        try {
          await fetch('https://aibackend.cp-devcode.com/webhook/1ef572d1-3263-4784-bc19-c38b3fbc09d0', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'booking_rejected',
              bookingId: bookingId,
              timestamp: new Date().toISOString()
            })
          });
        } catch (webhookError) {
          console.error('Webhook failed:', webhookError);
        }
        
        // Note: Real-time subscription will automatically update the UI
        
        alert('Booking rejected successfully!');
      } catch (error) {
        console.error('Error rejecting booking:', error);
        alert('Failed to reject booking. Please try again.');
      }
    }
  };

  const statsCards = [
    {
      title: 'Total Bookings',
      value: stats.totalBookings.toString(),
      change: '+12%',
      icon: Calendar,
      color: 'bg-blue-500'
    },
    {
      title: 'Active Members',
      value: stats.activeMembers.toString(),
      change: '+8%',
      icon: Users,
      color: 'bg-green-500'
    },
    {
      title: 'Monthly Revenue',
      value: `E£${stats.monthlyRevenue.toLocaleString()}`,
      change: '+15%',
      icon: DollarSign,
      color: 'bg-yellow-500'
    },
    {
      title: 'Pending Bookings',
      value: stats.pendingBookings.toString(),
      change: '+2',
      icon: Settings,
      color: 'bg-red-500'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-600">Manage your coworking space</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">Welcome back, {user.name}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statsCards.map((stat, index) => (
            <div key={index} className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-green-600">{stat.change}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('bookings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'bookings'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Bookings
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'customers'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Customers
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'analytics'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Analytics
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'bookings' && (
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Bookings</h3>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
                  </div>
                ) : bookings.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No bookings found.</p>
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Customer
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Workspace
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Date & Time
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {bookings.map((booking) => (
                        <tr key={booking.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">
                                  {booking.customer_name}
                                </div>
                                <div className="text-sm text-gray-500 flex items-center space-x-2">
                                  <Mail className="w-3 h-3" />
                                  <span>{booking.customer_email}</span>
                                </div>
                                <div className="text-sm text-gray-500 flex items-center space-x-2">
                                  <Phone className="w-3 h-3" />
                                  <span>{booking.customer_phone}</span>
                                </div>
                                <div className="text-sm text-gray-500 flex items-center space-x-2">
                                  <MessageCircle className="w-3 h-3" />
                                  <span>{booking.customer_whatsapp}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{booking.workspace_type}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{new Date(booking.date).toLocaleDateString()}</div>
                            <div className="text-sm text-gray-500">{booking.time_slot}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{booking.duration}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">${booking.total_price}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              booking.status === 'confirmed' 
                                ? 'bg-green-100 text-green-800'
                                : booking.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {booking.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                            {(booking.status === 'pending' || booking.status === 'code_sent') && (
                              <>
                                {booking.status === 'pending' && (
                                  <button
                                    onClick={() => handleConfirmBooking(booking.id)}
                                    className="text-green-600 hover:text-green-900"
                                    title="Send confirmation code"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRejectBooking(booking.id)}
                                  className="text-red-600 hover:text-red-900"
                                  title="Reject booking"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button className="text-blue-600 hover:text-blue-900">
                              <Edit className="w-4 h-4" />
                            </button>
                            <button className="text-red-600 hover:text-red-900">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            )}

            {activeTab === 'customers' && (
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Customer Database</h3>
                <p className="text-gray-600">Customer management features coming soon...</p>
              </div>
            )}

            {activeTab === 'analytics' && (
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Analytics & Reports</h3>
                <p className="text-gray-600">Advanced analytics features coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;