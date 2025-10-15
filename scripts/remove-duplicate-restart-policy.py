#!/usr/bin/env python3
"""
Script xóa duplicate restart_policy object form, giữ lại anchor form.
"""

import re

def remove_duplicate_restart_policy_objects(file_path: str):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Nếu dòng này là restart_policy anchor, giữ lại
        if 'restart_policy: *default-restart-policy' in line:
            result.append(line)
            i += 1
            continue
        
        # Nếu dòng này là restart_policy object, skip nó và các nested properties
        if re.match(r'^(\s+)restart_policy:\s*$', line):
            base_indent = len(line) - len(line.lstrip())
            i += 1
            
            # Skip tất cả nested properties (condition, delay, max_attempts, window)
            while i < len(lines):
                next_line = lines[i]
                
                # Empty line - skip
                if not next_line.strip():
                    i += 1
                    continue
                
                next_indent = len(next_line) - len(next_line.lstrip())
                
                # Nếu indent lớn hơn base (nested property) → skip
                if next_indent > base_indent:
                    i += 1
                    continue
                
                # Nếu indent bằng hoặc nhỏ hơn → end of restart_policy object
                break
            
            continue
        
        # Các dòng khác → giữ lại
        result.append(line)
        i += 1
    
    # Write back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(result)
    
    print(f"✅ Removed duplicate restart_policy objects from {file_path}")

if __name__ == '__main__':
    import sys
    if len(sys.argv) != 2:
        print("Usage: python remove-duplicate-restart-policy.py <file.yml>")
        sys.exit(1)
    
    remove_duplicate_restart_policy_objects(sys.argv[1])
