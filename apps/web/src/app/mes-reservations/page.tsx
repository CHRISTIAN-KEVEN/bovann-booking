import type { Metadata } from 'next';
import { MyBookings } from './MyBookings';

export const metadata: Metadata = { title: 'Retrouver ma réservation' };

export default function MyBookingsPage() {
  return <MyBookings />;
}
