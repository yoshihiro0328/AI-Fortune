"use client";
import { createContext, useContext } from "react";
import { paymentDisplay, type PaymentDisplayMode } from "@/lib/payment-display";
const PaymentDisplayContext = createContext<PaymentDisplayMode>("unavailable");
export function PaymentDisplayProvider({
  mode,
  children,
}: {
  mode: PaymentDisplayMode;
  children: React.ReactNode;
}) {
  return (
    <PaymentDisplayContext.Provider value={mode}>
      {children}
    </PaymentDisplayContext.Provider>
  );
}
export function usePaymentDisplay() {
  return paymentDisplay(useContext(PaymentDisplayContext));
}
