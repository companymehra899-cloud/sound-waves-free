export type Contact = {
  id: string;
  name: string;
  label: string;
  phone: string;
  initials: string;
  color: "emerald" | "sky" | "amber" | "rose" | "violet" | "teal";
};

export type CallRecord = {
  id: string;
  contact: Contact;
  direction: "incoming" | "outgoing" | "missed";
  when: string;
  duration?: string;
};

export const CONTACTS: Contact[] = [
  { id: "maya", name: "Maya Okafor", label: "Mobile", phone: "+1 555 010 2214", initials: "M", color: "emerald" },
  { id: "dad", name: "Dad", label: "Home", phone: "+1 555 010 8890", initials: "D", color: "sky" },
  { id: "sam", name: "Sam Rivera", label: "Work", phone: "+44 20 7946 0318", initials: "S", color: "amber" },
  { id: "priya", name: "Priya Nair", label: "Mobile", phone: "+91 98 2045 1177", initials: "P", color: "violet" },
  { id: "jonas", name: "Jonas Weber", label: "Mobile", phone: "+49 30 555 0142", initials: "J", color: "teal" },
  { id: "rosa", name: "Rosa Marín", label: "Mobile", phone: "+34 91 555 7761", initials: "R", color: "rose" },
];

export const INITIAL_CALLS: CallRecord[] = [
  { id: "c1", contact: CONTACTS[0], direction: "incoming", when: "Today · 09:14", duration: "00:14" },
  { id: "c2", contact: CONTACTS[1], direction: "outgoing", when: "Yesterday", duration: "03:42" },
  { id: "c3", contact: CONTACTS[2], direction: "missed", when: "Mon" },
  { id: "c4", contact: CONTACTS[3], direction: "incoming", when: "Sun · 18:02", duration: "12:05" },
];

export const AVATAR_STYLES: Record<Contact["color"], string> = {
  emerald: "bg-emerald-100 text-emerald-600",
  sky: "bg-sky-100 text-sky-600",
  amber: "bg-amber-100 text-amber-600",
  rose: "bg-rose-100 text-rose-500",
  violet: "bg-violet-100 text-violet-600",
  teal: "bg-teal-100 text-teal-600",
};
