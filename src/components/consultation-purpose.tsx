"use client";
import { purposes, purposeIds, type Purpose } from "@/lib/consultation/purpose";
export default function ConsultationPurpose({
  value,
  onChange,
  disabled = false,
}: {
  value: Purpose | "";
  onChange: (v: Purpose | "") => void;
  disabled?: boolean;
}) {
  return (
    <label className="purpose-picker">
      今回、相談したいこと（任意）
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Purpose | "")}
      >
        <option value="">選ばずに相談する</option>
        {purposeIds.map((id) => (
          <option key={id} value={id}>
            {purposes[id]}
          </option>
        ))}
      </select>
    </label>
  );
}
