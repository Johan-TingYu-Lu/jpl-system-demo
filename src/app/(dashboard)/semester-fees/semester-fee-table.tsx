'use client';

import { useState } from 'react';
import { updateSemesterFee } from './actions';
import { X } from 'lucide-react';

interface FeeData {
  amount: number;
  date: Date | null;
  status: string;
}

interface StudentFee {
  sheetsId: string;
  name: string;
  className: string;
  upper: FeeData | null;
  lower: FeeData | null;
}

interface Props {
  academicYear: number;
  students: StudentFee[];
}

export function SemesterFeeTable({ academicYear, students }: Props) {
  const [editing, setEditing] = useState<{ sheetsId: string; semester: 1 | 2; defaultAmount: number } | null>(null);
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formDate, setFormDate] = useState<string>('');
  const [loading, setLoading] = useState(false);

  function openEdit(student: StudentFee, semester: 1 | 2) {
    const fee = semester === 1 ? student.upper : student.lower;
    
    // Default values if empty
    const defaultDate = fee?.date ? new Date(fee.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const defaultAmount = fee?.amount || 0;

    setEditing({ sheetsId: student.sheetsId, semester, defaultAmount });
    setFormAmount(defaultAmount);
    setFormDate(defaultDate);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setLoading(true);

    try {
      await updateSemesterFee({
        sheetsId: editing.sheetsId,
        semester: editing.semester,
        academicYear,
        amount: formAmount,
        feeDateStr: formDate,
      });
      setEditing(null);
    } catch (err) {
      console.error(err);
      alert('更新失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">班級</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">上學期</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">下學期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {students.map(s => {
                const upperPaid = s.upper?.status === 'paid';
                const lowerPaid = s.lower?.status === 'paid';

                return (
                  <tr key={s.sheetsId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-500">{s.sheetsId}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.className}</td>
                    
                    {/* 上學期按鈕 */}
                    <td className="px-4 py-3 text-center">
                      <button 
                        onClick={() => openEdit(s, 1)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all hover:shadow-sm ${
                          upperPaid ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {upperPaid 
                          ? <span>${s.upper!.amount} <span className="opacity-50 text-[10px] ml-1">{s.upper!.date ? new Date(s.upper!.date).toLocaleDateString('en-CA').slice(5) : ''}</span></span> 
                          : '輸入收費'}
                      </button>
                    </td>

                    {/* 下學期按鈕 */}
                    <td className="px-4 py-3 text-center">
                      <button 
                        onClick={() => openEdit(s, 2)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all hover:shadow-sm ${
                          lowerPaid ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {lowerPaid 
                          ? <span>${s.lower!.amount} <span className="opacity-50 text-[10px] ml-1">{s.lower!.date ? new Date(s.lower!.date).toLocaleDateString('en-CA').slice(5) : ''}</span></span> 
                          : '輸入收費'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 編輯互動視窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                錄入雜費 ({editing.semester === 1 ? '上學期' : '下學期'})
              </h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">繳費金額</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input 
                    type="number" 
                    required
                    value={formAmount || ''}
                    onChange={e => setFormAmount(Number(e.target.value))}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="例如: 1500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">繳費日期</label>
                <input 
                  type="date" 
                  required
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? '儲存中...' : '儲存紀錄'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
