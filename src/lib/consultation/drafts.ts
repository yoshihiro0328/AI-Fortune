export type PendingConsultation = {
  requestId: string;
  text: string;
  regenerate?: boolean;
  regenerationId?: string;
};
export type Draft = { text: string; pending: PendingConsultation | null };
/** Component-lifetime memory only; never browser storage or a module singleton. */
export class ConversationDrafts {
  private values = new Map<string, Draft>();
  private owner: string | null = null;
  setOwner(owner: string) {
    if (this.owner !== owner) {
      this.clear();
      this.owner = owner;
    }
  }
  get(key: string): Draft {
    return this.values.get(key) ?? { text: "", pending: null };
  }
  update(key: string, patch: Partial<Draft>) {
    if (key) this.values.set(key, { ...this.get(key), ...patch });
  }
  move(from: string, to: string) {
    this.values.set(to, this.get(from));
    this.values.delete(from);
  }
  remove(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
    this.owner = null;
  }
}
