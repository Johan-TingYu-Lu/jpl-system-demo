'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, X } from 'lucide-react';

// 根據當前日期計算學年和班別選項
function getClassOptions() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const academicYear = month >= 8 ? year - 1911 : year - 1911 - 1;

  const cohort1 = academicYear + 3; // 高一
  const cohort2 = academicYear + 2; // 高二
  const cohort3 = academicYear + 1; // 高三

  const grades = [
    { grade: '高一', cohort: cohort1 },
    { grade: '高二', cohort: cohort2 },
    { grade: '高三', cohort: cohort3 },
  ];
  const subjects = [
    { code: 'M', label: '數學' },
    { code: 'N', label: '物理' },
  ];

  const options: { value: string; label: string; classCode: string; cohort: number }[] = [];
  for (const s of subjects) {
    for (const g of grades) {
      const className = `${s.code}${g.grade}班(${g.cohort})`;
      options.push({
        value: className,
        label: `${className} — ${s.label}`,
        classCode: s.code,
        cohort: g.cohort,
      });
    }
  }
  return options;
}

export function AddStudentModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const classOptions = getClassOptions();

  const [formData, setFormData] = useState({
    name: '',
    selectedClass: classOptions[0]?.value || '',
    phone: '',
    contactName: '',
    contactRelation: '',
    contactPhone: '',
  });

  const subjectMap: Record<string, string> = { 'M': '數學', 'N': '物理' };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name) { alert('姓名為必填'); return; }

    const selected = classOptions.find(o => o.value === formData.selectedClass);
    if (!selected) { alert('請選擇班別'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          classCode: selected.classCode,
          subject: subjectMap[selected.classCode] || '其他',
          className: selected.value,
          cohort: selected.cohort,
          phone: formData.phone,
          contactName: formData.contactName,
          contactRelation: formData.contactRelation,
          contactPhone: formData.contactPhone,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`新增失敗：${data.error || '發生錯誤'}`);
      } else {
        const msg = data.warning
          ? `新增成功！識別碼：${data.sheetsId}\n(但：${data.warning})`
          : `新增成功！識別碼：${data.sheetsId}`;
        alert(msg);
        setIsOpen(false);
        setFormData({ name: '', selectedClass: classOptions[0]?.value || '', phone: '', contactName: '', contactRelation: '', contactPhone: '' });
        router.refresh();
      }
    } catch (err) {
      alert('操作失敗：網路錯誤');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium whitespace-nowrap"
      >
        <UserPlus className="w-4 h-4" />
        新增學生
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">新增學生</h3>
              <button type="button" onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 p-1" title="關閉" aria-label="關閉">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 gap-4 flex flex-col">
              <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm text-blue-700">
                💡 識別碼將由系統自動指定（目前最大 ID + 1）
              </div>

              <div>
                <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-1">姓名 (必填)</label>
                <input id="studentName" type="text" required value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="輸入學生姓名" />
              </div>

              <div>
                <label htmlFor="selectedClass" className="block text-sm font-medium text-gray-700 mb-1">班別</label>
                <select id="selectedClass" value={formData.selectedClass}
                  onChange={e => setFormData({ ...formData, selectedClass: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                  {classOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">學生電話</label>
                <input id="phone" type="tel" value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="例如: 0912-345678" />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-500 mb-3">聯絡人資訊</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="contactName" className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                    <input id="contactName" type="text" value={formData.contactName}
                      onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="王小明" />
                  </div>
                  <div>
                    <label htmlFor="contactRelation" className="block text-sm font-medium text-gray-700 mb-1">關係</label>
                    <input id="contactRelation" type="text" value={formData.contactRelation}
                      onChange={e => setFormData({ ...formData, contactRelation: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="母子" />
                  </div>
                  <div>
                    <label htmlFor="contactPhone" className="block text-sm font-medium text-gray-700 mb-1">電話</label>
                    <input id="contactPhone" type="tel" value={formData.contactPhone}
                      onChange={e => setFormData({ ...formData, contactPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="0932-123456" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" disabled={loading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading ? '儲存中...' : '建立學生'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
