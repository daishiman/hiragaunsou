/**
 * 「一覧を直してまとめて保存する」画面の共通の土台。
 *
 * 使い方 (3手順):
 *   1. 直せる項目を宣言する
 *        const FIELDS: EditableFieldDef<Driver>[] = [
 *          { field: "driverName", label: "氏名", kind: "text", read: (d) => d.driverName },
 *        ];
 *   2. 編集状態を持つ
 *        const form = useEditableRecords({ records, rowKey: (d) => d.employeeCode,
 *                                          fields: FIELDS, submit: saveMasterChanges("driver") });
 *   3. 表の行と、画面の下の帯に渡す
 *        <EditableRowCells record={d} rowKey={key} fields={FIELDS} draft={form.draftOf(key)}
 *                          onChange={form.setField} fieldErrorOf={form.fieldErrorOf} rowLabel={...} />
 *        <EditFormActionBar form={form} />
 *
 * これだけで、入力欄・変更の色分け・元の値の併記・未保存件数・変更の取り消し・
 * 一部失敗の表示・保存しないまま離れようとしたときの確認が全部同じ挙動で付いてくる。
 * 項目が増えたときは 1. の宣言に1行足すだけでよい。
 */
export {
  normalizeFieldValue,
  fieldKindOf,
  fieldUnitOf,
  isFieldChanged,
  isUnreadableNumber,
  formatFieldValue,
  toSubmitValue,
  type EditableFieldDef,
  type EditableFieldKind,
  type EditableSelectOption,
} from "./fieldDefs";
export {
  useEditableRecords,
  fieldErrorKey,
  type EditChange,
  type EditSubmitFailure,
  type EditSubmitResult,
  type EditableRecordsForm,
  type RowDraft,
} from "./useEditableRecords";
export { EditableField, EditableRowCells, SelectEntryField } from "./EditableField";
export { EditFormActionBar } from "./EditFormActionBar";
export { UnsavedChangesBar } from "./UnsavedChangesBar";
export { UnsavedLeaveGuard } from "./UnsavedLeaveGuard";
export { requestLeave, setLeaveGuard, type LeaveGuard } from "./navigationGuard";
export { saveMasterChanges } from "./submitMasterChanges";
export { saveRateChanges } from "./submitRateChanges";
