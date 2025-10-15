#!/usr/bin/env python3
"""
Script xóa duplicate restart_policy trong stack YAML.
Giữ lại anchor version (*default-restart-policy), xóa object version.
"""

import re
import sys

def fix_duplicates(yaml_content: str) -> str:
    """
    Xóa duplicate restart_policy keys trong deploy sections.
    """
    lines = yaml_content.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Check if this is restart_policy anchor
        if 'restart_policy: *default-restart-policy' in line:
            result.append(line)
            i += 1
            
            # Look ahead để xóa duplicate restart_policy object nếu có
            skip_count = 0
            for j in range(i, min(i + 10, len(lines))):
                next_line = lines[j]
                
                # Found duplicate restart_policy object
                if re.match(r'^(\s+)restart_policy:\s*$', next_line):
                    # Skip this line and all nested lines
                    skip_count = 1
                    base_indent = len(next_line) - len(next_line.lstrip())
                    
                    # Skip nested properties (condition, delay, max_attempts, window)
                    for k in range(j + 1, len(lines)):
                        nested_line = lines[k]
                        if not nested_line.strip():  # Empty line
                            skip_count += 1
                            continue
                        nested_indent = len(nested_line) - len(nested_line.lstrip())
                        if nested_indent > base_indent:
                            skip_count += 1
                        else:
                            break
                    break
                
                # Stop checking if we hit another top-level key
                if re.match(r'^(\s{4,8})\w+:', next_line) and 'restart_policy' not in next_line:
                    break
            
            # Skip the duplicate lines
            i += skip_count
            continue
        
        result.append(line)
        i += 1
    
    return '\n'.join(result)

def main():
    if len(sys.argv) != 2:
        print("Usage: python fix-duplicate-restart-policy.py <stack-file.yml>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Fix duplicates
        modified_content = fix_duplicates(content)
        
        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(modified_content)
        
        print(f"✅ Successfully fixed duplicate restart_policy in {file_path}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
