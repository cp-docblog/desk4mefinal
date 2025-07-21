import React, { createContext, useContext, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface BookingContextType {
  confirmBooking: (bookingId: string, confirmationCode: string) => Promise<void>;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (context === undefined) {
    throw new Error('useBooking must be used within a BookingProvider');
  }
  return context;
};

export const BookingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const confirmBooking = async (bookingId: string, confirmationCode: string) => {
    try {
      // Fetch the current booking from database
      const { data: currentBooking, error: fetchError } = await supabase
        .from('bookings')
        .select()
        .eq('id', bookingId)
        .single();

      if (fetchError) throw fetchError;
      if (!currentBooking) throw new Error('Booking not found');

      // Check if booking status allows confirmation
      if (currentBooking.status !== 'code_sent') {
        throw new Error(`Booking status is ${currentBooking.status}. Code must be sent by admin first.`);
      }

      // Verify confirmation code
      if (currentBooking.confirmation_code !== confirmationCode) {
        throw new Error('Invalid confirmation code');
      }
    
      // Update booking status to confirmed
      const { data, error } = await supabase
        .from('bookings')
        .update({
          confirmation_code: confirmationCode,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .select()
        .single();

      if (error) throw error;

      // Send webhook notification
      try {
        await fetch('https://aibackend.cp-devcode.com/webhook/1ef572d1-3263-4784-bc19-c38b3fbc09d0', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'booking_confirmed_by_customer',
            bookingId: bookingId,
            confirmationCode: confirmationCode,
            customerData: {
              name: currentBooking.customer_name,
              whatsapp: currentBooking.customer_whatsapp,
              email: currentBooking.customer_email
            },
            bookingDetails: {
              workspace_type: currentBooking.workspace_type,
              date: currentBooking.date,
              time_slot: currentBooking.time_slot,
              duration: currentBooking.duration,
              total_price: currentBooking.total_price
            },
            timestamp: new Date().toISOString()
          })
        });
      } catch (webhookError) {
        console.error('Webhook failed:', webhookError);
        // Don't fail the confirmation if webhook fails
      }

      console.log('Booking confirmed successfully:', data);
      return data;
      
    } catch (error) {
      console.error('Booking confirmation failed:', error);
      throw error;
    }
  };

  return (
    <BookingContext.Provider value={{ 
      confirmBooking
    }}>
      {children}
    </BookingContext.Provider>
  );
};