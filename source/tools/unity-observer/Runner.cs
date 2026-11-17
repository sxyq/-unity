/* 常驻驱动：Unity 场景切换会让早期创建的 MonoBehaviour 被销毁，
 * 也会让 SynchronizationContext 失效（定时器 Post 不再执行）。
 * 这里用 DontDestroyOnLoad 的隐藏 GameObject + Update 驱动，保证每帧都能采样。
 */
using UnityEngine;

namespace Gqy
{
    public class GqyRunner : MonoBehaviour
    {
        private void Update()
        {
            try { Observer.StaticTick(); } catch { }
        }
    }

    public static class Runner
    {
        private static bool _spawned;
        public static void Ensure()
        {
            if (_spawned) return;
            _spawned = true;
            try
            {
                var go = new GameObject("GqyObserverRunner");
                Object.DontDestroyOnLoad(go);
                go.hideFlags = HideFlags.HideAndDontSave;
                go.AddComponent<GqyRunner>();
            }
            catch { }
        }
    }
}
